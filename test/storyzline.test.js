'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { resolveLocation, loginCheckUrl, responseProblem } = require('../public/shared/location');
const { analyse } = require('../public/shared/java');
const { checkTarget } = require('../lib/proxy');

const server = { baseUrl: 'https://git.example.com/bitbucket', project: 'ECOM', repo: 'ecomm-api', branch: 'develop' };
const cloud = { baseUrl: 'https://bitbucket.org', branch: 'main' };

test('Server browse URL resolves to the raw REST endpoint', () => {
  const r = resolveLocation('https://git.example.com/bitbucket/projects/ECOM/repos/ecomm-api/browse/src/main/java/A.java?at=refs%2Fheads%2Frelease%2F1.2', server);
  assert.strictEqual(r.project, 'ECOM');
  assert.strictEqual(r.ref, 'refs/heads/release/1.2');
  assert.strictEqual(r.rawUrl, 'https://git.example.com/bitbucket/rest/api/1.0/projects/ECOM/repos/ecomm-api/raw/src/main/java/A.java?at=refs%2Fheads%2Frelease%2F1.2');
});

test('Server personal repo URL uses ~user project', () => {
  const r = resolveLocation('https://git.example.com/bitbucket/users/jdoe/repos/x/browse/A.java', server);
  assert.strictEqual(r.project, '~jdoe');
  assert.match(r.rawUrl, /projects\/~jdoe\/repos\/x\/raw\/A\.java\?at=develop$/);
});

test('plain path uses the default repo and Windows separators', () => {
  const r = resolveLocation('\\src\\main\\java\\B.java', server);
  assert.strictEqual(r.path, 'src/main/java/B.java');
  assert.strictEqual(r.rawUrl, 'https://git.example.com/bitbucket/rest/api/1.0/projects/ECOM/repos/ecomm-api/raw/src/main/java/B.java?at=develop');
});

test('Cloud src URL resolves to the 2.0 API', () => {
  const r = resolveLocation('https://bitbucket.org/acme/ecomm/src/main/src/C.java', cloud);
  assert.strictEqual(r.rawUrl, 'https://api.bitbucket.org/2.0/repositories/acme/ecomm/src/main/src/C.java');
  assert.strictEqual(loginCheckUrl(cloud), 'https://api.bitbucket.org/2.0/user');
  assert.strictEqual(loginCheckUrl(server), 'https://git.example.com/bitbucket/rest/api/1.0/projects?limit=1');
});

test('rejects foreign hosts, traversal and missing defaults', () => {
  assert.throws(() => resolveLocation('https://evil.example.net/projects/A/repos/b/browse/x.java', server), /does not match/);
  assert.throws(() => resolveLocation('src/../../etc/passwd', server), /\.\./);
  assert.throws(() => resolveLocation('A.java', { baseUrl: 'https://git.example.com' }), /default project and repo/);
  assert.throws(() => resolveLocation('A.java', { baseUrl: 'file:///etc' }), /must start with http/);
});

test('proxy only sends the login to the Bitbucket host', () => {
  assert.doesNotThrow(() => checkTarget('https://git.example.com/x', 'https://git.example.com/bitbucket'));
  assert.doesNotThrow(() => checkTarget('https://api.bitbucket.org/2.0/user', 'https://bitbucket.org'));
  assert.throws(() => checkTarget('https://evil.example.net/x', 'https://git.example.com'), /Refusing/);
  assert.throws(() => checkTarget('file:///etc/passwd', 'https://git.example.com'), /http\(s\)/);
});

test('responseProblem explains Bitbucket replies', () => {
  assert.strictEqual(responseProblem({ status: 200, contentType: 'text/plain' }, 'nf'), null);
  assert.match(responseProblem({ status: 401 }, 'nf'), /rejected the login/);
  assert.strictEqual(responseProblem({ status: 404 }, 'nf'), 'nf');
  assert.match(responseProblem({ status: 200, contentType: 'text/html' }, 'nf'), /HTML page/);
});

const JAVA = `package com.bank.ecomm.enq;

import org.springframework.web.bind.annotation.*;

/** Handles @GetMapping("/not-real") in a comment. */
@RestController
@RequestMapping(value = "/enq/customer", produces = "application/json")
public class PortfolioEndpoint {

    // @PostMapping("/commented-out")
    @GetMapping("/portfolio/{customerId}")
    public Portfolio getPortfolio(@PathVariable("customerId") String id) {
        return service.find(id);
    }

    @RequestMapping(path = {"/summary", "/overview"}, method = {RequestMethod.GET, RequestMethod.POST})
    public Summary summary() { return null; }

    @PostMapping
    public void create(@RequestBody Portfolio p) { }
}
`;

test('finds Spring mappings and ignores comments', () => {
  const a = analyse(JAVA, '');
  assert.strictEqual(a.packageName, 'com.bank.ecomm.enq');
  const rows = a.endpoints.flatMap(e => e.paths.map(p => `${e.methods.join('|')} ${p} ${e.methodName}`));
  assert.deepStrictEqual(rows, [
    'GET /enq/customer/portfolio/{customerId} getPortfolio',
    'GET|POST /enq/customer/summary summary',
    'GET|POST /enq/customer/overview summary',
    'POST /enq/customer create',
  ]);
  assert.strictEqual(a.endpoints[0].declLine, 12);
});

test('matches an eCommAPI with a context path and a path variable', () => {
  const a = analyse(JAVA, 'https://api.bank.com/spl-banking/enq/customer/portfolio/12345?x=1');
  assert.strictEqual(a.matches[0].methodName, 'getPortfolio');
  assert.strictEqual(a.matches[0].match, 'suffix');
  const exact = analyse(JAVA, '/enq/customer/summary/');
  assert.strictEqual(exact.matches[0].match, 'exact');
});

test('JAX-RS @Path with verb annotations', () => {
  const src = '@Path("/accounts")\npublic class A {\n  @GET\n  @Path("{id}/balance")\n  public Response bal(@PathParam("id") String id) { return null; }\n}';
  const a = analyse(src, '/accounts/9/balance');
  assert.deepStrictEqual(a.endpoints[0].methods, ['GET']);
  assert.strictEqual(a.matches[0].match, 'exact');
});

// A fake Bitbucket Server that accepts jdoe / s3cret.
async function startMockBitbucket() {
  const mock = http.createServer((req, res) => {
    const ok = req.headers.authorization === 'Basic ' + Buffer.from('jdoe:s3cret').toString('base64');
    if (!ok) { res.writeHead(401); return res.end(); }
    if (req.url.includes('Missing.java')) { res.writeHead(404); return res.end(); }
    const raw = req.url.includes('/raw/');
    res.writeHead(200, { 'Content-Type': raw ? 'text/plain' : 'application/json' });
    res.end(raw ? JAVA : '{"values":[]}');
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  return { mock, baseUrl: `http://127.0.0.1:${mock.address().port}` };
}

// The same checks run against the Node server and the PowerShell server.
async function checkServer(app, baseUrl) {
  const connection = { baseUrl, user: 'jdoe', password: 's3cret' };
  const post = (body, headers = {}) => fetch(app + '/api/get', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

  const page = await fetch(app + '/');
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /shared\/java\.js/);
  assert.strictEqual((await fetch(app + '/shared/location.js')).status, 200);
  assert.strictEqual((await fetch(app + '/..%2fserver.js')).status, 403);

  const loc = resolveLocation('src/PortfolioEndpoint.java', { baseUrl, project: 'ECOM', repo: 'api', branch: 'main' });
  const file = await (await post({ url: loc.rawUrl, connection })).json();
  assert.strictEqual(file.status, 200);
  assert.strictEqual(file.body, JAVA);
  assert.strictEqual(analyse(file.body, '/enq/customer/summary').matches[0].methodName, 'summary');

  assert.strictEqual((await (await post({ url: loginCheckUrl({ baseUrl }), connection })).json()).status, 200);
  assert.strictEqual((await (await post({ url: loc.rawUrl, connection: { ...connection, password: 'nope' } })).json()).status, 401);
  assert.strictEqual((await (await post({ url: loc.rawUrl.replace('PortfolioEndpoint', 'Missing'), connection })).json()).status, 404);

  const foreign = await post({ url: 'http://evil.example.net/x', connection });
  assert.strictEqual(foreign.status, 403);
  assert.match((await foreign.json()).error, /Refusing/);
  assert.strictEqual((await post({ url: loc.rawUrl, connection }, { Origin: 'https://evil.example' })).status, 403);
  const plain = await fetch(app + '/api/get', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.strictEqual(plain.status, 403);
  const down = await post({ url: 'http://127.0.0.1:9/x', connection: { ...connection, baseUrl: 'http://127.0.0.1:9' } });
  assert.strictEqual(down.status, 502);
  assert.match((await down.json()).error, /Could not reach Bitbucket/);
}

test('Node server proxies Bitbucket with the page login', async () => {
  const { mock, baseUrl } = await startMockBitbucket();
  process.env.PORT = '5191';
  const { server: app } = require('../server');
  await new Promise(r => app.listen(5191, '127.0.0.1', r));
  try {
    await checkServer('http://127.0.0.1:5191', baseUrl);
  } finally {
    app.close();
    mock.close();
  }
});

const hasPowerShell = process.platform === 'win32' && spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0']).status === 0;

test('PowerShell server behaves the same', { skip: !hasPowerShell && 'Windows PowerShell not available' }, async () => {
  const { mock, baseUrl } = await startMockBitbucket();
  const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'server.ps1'), '-Port', '5192']);
  let out = '';
  ps.stdout.on('data', d => { out += d; });
  ps.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 100 && !out.includes('running at'); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(out, /running at/, `server.ps1 did not start:\n${out}`);
    await checkServer('http://127.0.0.1:5192', baseUrl);
  } finally {
    ps.kill();
    mock.close();
  }
});
