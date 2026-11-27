'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { resolveLocation, fetchFile } = require('../lib/bitbucket');
const { analyse } = require('../lib/java');

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

test('plain path uses .env defaults and Windows separators', () => {
  const r = resolveLocation('\\src\\main\\java\\B.java', server);
  assert.strictEqual(r.path, 'src/main/java/B.java');
  assert.strictEqual(r.rawUrl, 'https://git.example.com/bitbucket/rest/api/1.0/projects/ECOM/repos/ecomm-api/raw/src/main/java/B.java?at=develop');
});

test('Cloud src URL resolves to the 2.0 API', () => {
  const r = resolveLocation('https://bitbucket.org/acme/ecomm/src/main/src/C.java', cloud);
  assert.strictEqual(r.rawUrl, 'https://api.bitbucket.org/2.0/repositories/acme/ecomm/src/main/src/C.java');
});

test('rejects foreign hosts, traversal and missing defaults', () => {
  assert.throws(() => resolveLocation('https://evil.example.net/projects/A/repos/b/browse/x.java', server), /does not match/);
  assert.throws(() => resolveLocation('src/../../etc/passwd', server), /\.\./);
  assert.throws(() => resolveLocation('A.java', { baseUrl: 'https://git.example.com' }), /default project and repo/);
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

test('fetchFile end to end against a mock Bitbucket Server', async () => {
  let seen;
  const mock = http.createServer((req, res) => {
    seen = req;
    if (req.headers.authorization !== 'Bearer t0k') { res.writeHead(401); return res.end(); }
    if (req.url.includes('Missing.java')) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(JAVA);
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  try {
    const cfg = { baseUrl: base, token: 't0k', project: 'ECOM', repo: 'api', branch: 'main' };
    const f = await fetchFile(`${base}/projects/ECOM/repos/api/browse/src/PortfolioEndpoint.java?at=main`, cfg);
    assert.strictEqual(f.content, JAVA);
    assert.strictEqual(seen.url, '/rest/api/1.0/projects/ECOM/repos/api/raw/src/PortfolioEndpoint.java?at=main');
    await assert.rejects(fetchFile('src/Missing.java', cfg), /File not found/);
    await assert.rejects(fetchFile('src/A.java', { ...cfg, token: 'bad' }), /rejected the login/);
  } finally {
    mock.close();
  }
});

test('server uses the login typed in the page and blocks other origins', async () => {
  let auth;
  const mock = http.createServer((req, res) => {
    auth = req.headers.authorization;
    const ok = auth === 'Basic ' + Buffer.from('jdoe:s3cret').toString('base64');
    if (!ok) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': req.url.includes('/raw/') ? 'text/plain' : 'application/json' });
    res.end(req.url.includes('/raw/') ? JAVA : '{"values":[]}');
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  process.env.PORT = '5191';
  const { server } = require('../server');
  await new Promise(r => server.listen(5191, '127.0.0.1', r));
  const app = 'http://127.0.0.1:5191';
  const connection = { baseUrl: `http://127.0.0.1:${mock.address().port}`, user: 'jdoe', password: 's3cret', project: 'ECOM', repo: 'api' };
  const post = (url, body, headers = {}) => fetch(app + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  try {
    assert.strictEqual((await post('/api/check', { connection })).status, 200);
    const bad = await post('/api/check', { connection: { ...connection, password: 'nope' } });
    assert.strictEqual(bad.status, 502);
    assert.match((await bad.json()).error, /rejected the login/);

    const r = await post('/api/fetch', { ecommApi: '/enq/customer/summary', location: 'src/PortfolioEndpoint.java', connection });
    const data = await r.json();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(data.analysis.matches[0].methodName, 'summary');

    assert.strictEqual((await post('/api/fetch', { location: 'x.java', connection }, { Origin: 'https://evil.example' })).status, 403);
    const plain = await fetch(app + '/api/fetch', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.strictEqual(plain.status, 403);
    const rejected = await post('/api/check', { connection: { ...connection, baseUrl: 'file:///etc' } });
    assert.match((await rejected.json()).error, /must start with http/);
  } finally {
    server.close();
    mock.close();
  }
});
