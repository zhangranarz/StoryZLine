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

// A fake Bitbucket Server that accepts jdoe / s3cret. /redirect-away sends the client to
// another host name (localhost instead of 127.0.0.1); the login must never follow it there.
async function startMockBitbucket() {
  const leaks = [];
  const mock = http.createServer((req, res) => {
    if (req.url === '/redirect-away') {
      res.writeHead(302, { Location: `http://localhost:${mock.address().port}/landed` });
      return res.end();
    }
    if (req.url === '/landed') {
      if (req.headers.authorization) leaks.push(req.headers.authorization);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('landed');
    }
    const ok = req.headers.authorization === 'Basic ' + Buffer.from('jdoe:s3cret').toString('base64');
    if (!ok) { res.writeHead(401); return res.end(); }
    if (req.url.includes('Missing.java')) { res.writeHead(404); return res.end(); }
    const raw = req.url.includes('/raw/');
    res.writeHead(200, { 'Content-Type': raw ? 'text/plain' : 'application/json' });
    res.end(raw ? JAVA : '{"values":[]}');
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  return { mock, leaks, baseUrl: `http://127.0.0.1:${mock.address().port}` };
}

// The same checks run against the Node, PowerShell and Python servers.
async function checkServer(app, { baseUrl, leaks }) {
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

  // A redirect may be refused or followed, but the login must not reach the other host.
  await post({ url: baseUrl + '/redirect-away', connection });
  assert.deepStrictEqual(leaks, [], 'login was forwarded to a redirect target on another host');
}

async function checkSpawnedServer(command, args, port) {
  const mockInfo = await startMockBitbucket();
  const child = spawn(command, args);
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 100 && !out.includes('running at'); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(out, /running at/, `${command} server did not start:\n${out}`);
    await checkServer(`http://127.0.0.1:${port}`, mockInfo);
  } finally {
    child.kill();
    mockInfo.mock.close();
  }
}

test('Node server proxies Bitbucket with the page login', async () => {
  const mockInfo = await startMockBitbucket();
  process.env.PORT = '5191';
  const { server: app } = require('../server');
  await new Promise(r => app.listen(5191, '127.0.0.1', r));
  try {
    await checkServer('http://127.0.0.1:5191', mockInfo);
  } finally {
    app.close();
    mockInfo.mock.close();
  }
});

const hasPowerShell = process.platform === 'win32' && spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0']).status === 0;
const python = ['python', 'python3'].find(p => spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)']).status === 0);

test('PowerShell server behaves the same', { skip: !hasPowerShell && 'Windows PowerShell not available' }, () =>
  checkSpawnedServer('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'server.ps1'), '-Port', '5192'], 5192));

test('Python server behaves the same', { skip: !python && 'Python 3.7+ not available' }, () =>
  checkSpawnedServer(python, ['-u', path.join(__dirname, '..', 'server.py'), '--port', '5193'], 5193));

test('Python server goes direct when the company proxy demands a login (407)', { skip: !python && 'Python 3.7+ not available' }, async () => {
  const { mock, baseUrl } = await startMockBitbucket();
  // A proxy that refuses everything, like a company proxy wanting a Windows sign-in.
  const seen = [];
  const proxy = http.createServer((req, res) => {
    seen.push(req.method);
    res.writeHead(407, { 'Proxy-Authenticate': 'NTLM' });
    res.end();
  });
  proxy.on('connect', (req, socket) => {
    seen.push('CONNECT');
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: NTLM\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const env = { ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl };
  for (const k of ['NO_PROXY', 'no_proxy']) delete env[k];
  const child = spawn(python, ['-u', path.join(__dirname, '..', 'server.py'), '--port', '5194'], { env });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const connection = { baseUrl, user: 'jdoe', password: 's3cret' };
  const post = body => fetch('http://127.0.0.1:5194/api/get', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (let i = 0; i < 100 && !out.includes('Proxy mode'); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(out, /Proxy mode: auto/);

    // Plain http: the proxy answers 407, then StoryZLine connects directly and gets the file.
    const loc = resolveLocation('src/PortfolioEndpoint.java', { baseUrl, project: 'ECOM', repo: 'api', branch: 'main' });
    const file = await (await post({ url: loc.rawUrl, connection })).json();
    assert.strictEqual(file.status, 200);
    assert.strictEqual(file.body, JAVA);
    assert.ok(seen.includes('GET'), 'request should have tried the proxy first');

    // https: the proxy refuses the tunnel ("Tunnel connection failed: 407"); the direct retry is also
    // attempted (it fails here because the mock has no TLS) and the error names both.
    const httpsBase = baseUrl.replace('http:', 'https:');
    const r = await post({ url: httpsBase + '/x', connection: { ...connection, baseUrl: httpsBase } });
    assert.strictEqual(r.status, 502);
    assert.match((await r.json()).error, /directly.*also refused \(407/s);
    assert.ok(seen.includes('CONNECT'), 'https request should have tried the proxy tunnel first');
  } finally {
    child.kill();
    proxy.close();
    mock.close();
  }
});

// ---- Pick from Excel ----

const zlib = require('zlib');
const { buildFileUrl } = require('../public/shared/location');
const { readXlsx, readCsv, toEntries, readTable } = require('../public/shared/excel');

test('buildFileUrl joins Bitbucket URL, project, repo, location, path and file name', () => {
  const parts = {
    baseUrl: 'https://git.example.com/bitbucket/', project: 'ECOM', repo: 'ecomm-api', branch: 'develop',
    location: '/src/main/java/com/bank/ecomm/', path: '\\enq\\customer\\', fileName: 'PortfolioEndpoint',
  };
  const url = buildFileUrl(parts);
  assert.strictEqual(url, 'https://git.example.com/bitbucket/projects/ECOM/repos/ecomm-api/browse/src/main/java/com/bank/ecomm/enq/customer/PortfolioEndpoint.java?at=develop');
  // It reads back to the same file.
  const back = resolveLocation(url, { baseUrl: parts.baseUrl });
  assert.deepStrictEqual([back.project, back.repo, back.ref, back.path],
    ['ECOM', 'ecomm-api', 'develop', 'src/main/java/com/bank/ecomm/enq/customer/PortfolioEndpoint.java']);

  assert.strictEqual(buildFileUrl({ ...parts, branch: '', path: '', fileName: 'A.java' }),
    'https://git.example.com/bitbucket/projects/ECOM/repos/ecomm-api/browse/src/main/java/com/bank/ecomm/A.java');
  assert.strictEqual(buildFileUrl({ baseUrl: 'https://bitbucket.org', project: 'acme', repo: 'api', branch: 'main', location: 'src', fileName: 'B' }),
    'https://bitbucket.org/acme/api/src/main/src/B.java');
  const release = buildFileUrl({ ...parts, branch: 'release/1.2' });
  assert.match(release, /\?at=release\/1\.2$/);
  assert.strictEqual(resolveLocation(release, { baseUrl: parts.baseUrl }).ref, 'release/1.2');
  assert.throws(() => buildFileUrl({ ...parts, fileName: '' }), /File name/);
  assert.throws(() => buildFileUrl({ ...parts, path: '../secret' }), /\.\./);
});

test('CSV list: header found below a title, semicolons, quotes and duplicates', () => {
  const csv = '﻿My endpoint list;;;;\r\n' +
    'Bitbucket URL;Project Key;Repository;Branch;EndPoint Java File Location\r\n' +
    'https://git.example.com;ECOM;ecomm-api;develop;"src/main/java/a;b"\r\n' +
    'https://git.example.com;ECOM;ecomm-api;develop;"src/main/java/a;b"\r\n' +
    ';;;;\r\n' +
    'https://git.example.com;PAY;pay-api;main;src/main/java/pay\r\n';
  const { entries, columns } = toEntries(readCsv(csv));
  assert.deepStrictEqual(columns, ['baseUrl', 'project', 'repo', 'branch', 'location']);
  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(entries[0], { baseUrl: 'https://git.example.com', project: 'ECOM', repo: 'ecomm-api', branch: 'develop', location: 'src/main/java/a;b' });
  assert.throws(() => toEntries([['Name', 'Value'], ['a', 'b']]), /header row/);
});

// Builds a zip the way Excel does (deflated entries, central directory at the end).
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const stored = name.endsWith('.rels');  // exercise both stored and deflated entries
    const data = stored ? raw : zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('reads the first sheet of an .xlsx file', async () => {
  const xlsx = makeZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Endpoints" sheetId="3" r:id="rId7"/><sheet name="Other" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Target="worksheets/sheet7.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst count="7"><si><t>Bitbucket URL</t></si><si><t>Project key</t></si>' +
      '<si><r><rPr><b/></rPr><t>Repo</t></r><r><t xml:space="preserve">sitory</t></r></si><si><t>Branch</t></si>' +
      '<si><t>Endpoint Java file location</t></si><si><t>https://git.example.com/bitbucket</t></si><si><t>feature/a&amp;b</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong sheet</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet7.xml': '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="inlineStr"><is><t>ECOM</t></is></c><c r="C2" t="str"><v>ecomm-api</v></c><c r="D2" t="s"><v>6</v></c><c r="E2" s="1"/></row>' +
      '<row r="3" spans="1:5"/>' +
      '<row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4"><v>2024</v></c><c r="C4" t="inlineStr"><is><t>legacy</t></is></c><c r="E4" t="inlineStr"><is><t>src/main/java</t></is></c></row>' +
      '</sheetData></worksheet>',
  });
  const rows = await readTable('Endpoints.xlsx', xlsx);
  assert.deepStrictEqual(rows[0], ['Bitbucket URL', 'Project key', 'Repository', 'Branch', 'Endpoint Java file location']);
  const { entries } = toEntries(rows);
  assert.deepStrictEqual(entries, [
    { baseUrl: 'https://git.example.com/bitbucket', project: 'ECOM', repo: 'ecomm-api', branch: 'feature/a&b', location: '' },
    { baseUrl: 'https://git.example.com/bitbucket', project: '2024', repo: 'legacy', branch: '', location: 'src/main/java' },
  ]);
  await assert.rejects(readXlsx(Buffer.from('not a zip')), /not an \.xlsx/);
  await assert.rejects(readTable('old.xls', Buffer.alloc(0)), /\.xls files are not supported/);
});
