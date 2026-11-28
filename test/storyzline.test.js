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

test('each endpoint knows its whole section, from leading comments to the closing brace', () => {
  const [portfolio, summary, overview, create] = analyse(JAVA, '').endpoints.flatMap(e => e.paths.map(() => e));
  assert.deepStrictEqual([portfolio.startLine, portfolio.endLine], [10, 14]);  // includes the // comment above
  assert.deepStrictEqual([summary.startLine, summary.endLine], [16, 17]);      // one-line body
  assert.strictEqual(overview, summary);
  assert.deepStrictEqual([create.startLine, create.endLine], [19, 20]);

  const tricky = [
    '@RestController',
    'public class T {',
    '    /**',
    '     * Javadoc with a } brace.',
    '     */',
    '    @GetMapping("/t")',
    '    public String t() {',
    '        String s = "}{";',
    '        char c = \'}\';',
    '        if (s.isEmpty()) { return "x"; }',
    '        return s;',
    '    }',
    '}',
  ].join('\n');
  const t = analyse(tricky, '/t').matches[0];
  assert.deepStrictEqual([t.startLine, t.endLine], [3, 12]);

  const iface = '@Path("/a")\npublic interface A {\n  @GET\n  @Path("/b")\n  Response b();\n}';
  const b = analyse(iface, '/a/b').matches[0];
  assert.deepStrictEqual([b.startLine, b.endLine], [3, 5]);  // no body: ends at the ";"
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
  assert.throws(() => buildFileUrl({ ...parts, fileName: '' }), /Fill in File/);

  // A separate extension part: added once, with or without its dot; "" adds none.
  const noLoc = { ...parts, location: '', path: 'src/main/resources', branch: '' };
  assert.match(buildFileUrl({ ...noLoc, fileName: 'application', extension: '.yml' }), /\/src\/main\/resources\/application\.yml$/);
  assert.match(buildFileUrl({ ...noLoc, fileName: 'application', extension: 'properties' }), /\/application\.properties$/);
  assert.match(buildFileUrl({ ...noLoc, fileName: 'Portfolio.java', extension: '.java' }), /\/Portfolio\.java$/);
  assert.match(buildFileUrl({ ...noLoc, fileName: 'Dockerfile', extension: '' }), /\/Dockerfile$/);
  assert.throws(() => buildFileUrl({ ...noLoc, fileName: 'a', extension: '.ja va' }), /Extension may only/);
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
  assert.deepStrictEqual(columns, ['baseUrl', 'project', 'repo']);
  // Branch and Endpoint Java file location are not read; the duplicate row is dropped.
  assert.deepStrictEqual(entries, [
    { baseUrl: 'https://git.example.com', project: 'ECOM', repo: 'ecomm-api' },
    { baseUrl: 'https://git.example.com', project: 'PAY', repo: 'pay-api' },
  ]);
  assert.throws(() => toEntries([['Name', 'Value'], ['a', 'b']]), /header row/);
});

test('an empty Bitbucket URL or Project key cell means "same as above"', () => {
  // Laid out like a real list: the URL is only written on the first row.
  const rows = [
    ['Bitbucket URL', 'Project key', 'Repository', 'Branch'],
    ['https://bitbucket.example.com/', 'SPL', 'ecomm-services', 'Develop'],
    ['', 'SPL', 'enterprise-services', 'Develop'],
    ['', '', 'batch-services', ''],
    ['', 'PAY', 'pay-api', ''],
    ['', '', '', 'a note in the Branch column'],
    ['https://other.example.com', 'CARD', 'card-api', ''],
  ];
  assert.deepStrictEqual(toEntries(rows).entries, [
    { baseUrl: 'https://bitbucket.example.com/', project: 'SPL', repo: 'ecomm-services' },
    { baseUrl: 'https://bitbucket.example.com/', project: 'SPL', repo: 'enterprise-services' },
    { baseUrl: 'https://bitbucket.example.com/', project: 'SPL', repo: 'batch-services' },
    { baseUrl: 'https://bitbucket.example.com/', project: 'PAY', repo: 'pay-api' },
    { baseUrl: 'https://other.example.com', project: 'CARD', repo: 'card-api' },
  ]);
  // The first row can't borrow from above.
  assert.throws(() => toEntries([['Bitbucket URL', 'Project key', 'Repository'], ['', 'SPL', 'x']]), /no filled-in rows/);
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
  assert.strictEqual(rows[1][3], 'feature/a&b');  // entities decoded
  assert.deepStrictEqual(entries, [
    { baseUrl: 'https://git.example.com/bitbucket', project: 'ECOM', repo: 'ecomm-api' },
    { baseUrl: 'https://git.example.com/bitbucket', project: '2024', repo: 'legacy' },
  ]);
  await assert.rejects(readXlsx(Buffer.from('not a zip')), /not an \.xlsx/);
  await assert.rejects(readTable('old.xls', Buffer.alloc(0)), /\.xls files are not supported/);
});

// ---- Demo kit (samples/ and tools/mock_bitbucket.py) ----

const fs = require('fs');
const SAMPLES = path.join(__dirname, '..', 'samples');
const sample = p => fs.readFileSync(path.join(SAMPLES, p), 'utf8');
const SPRING = 'ecomm-services/src/main/java/com/example/ecomm/enq/CustomerPortfolioEndpoint.java';
const JAXRS = 'enterprise-services/src/main/java/com/example/enterprise/AccountBalanceResource.java';

test('demo files give the results listed in samples/README.md', () => {
  const found = (file, api) => analyse(sample(file), api).matches.map(m => `${m.methods.join('|')} ${m.methodName} ${m.match}`);
  assert.deepStrictEqual(found(SPRING, '/spl-banking/enq/customer/portfolio/12345'),
    ['GET getPortfolio suffix', 'POST updatePortfolio suffix']);
  assert.deepStrictEqual(found(SPRING, '/enq/customer/overview'), ['GET|POST summary exact']);
  assert.deepStrictEqual(found(SPRING, '/spl-banking/enq/customer/portfolio/12345/holdings/H-9'), ['DELETE removeHolding suffix']);
  assert.deepStrictEqual(found(SPRING, '/enq/customer/unknown'), []);
  assert.deepStrictEqual(found(JAXRS, '/accounts/123-456/balance'), ['GET balance exact']);
  assert.deepStrictEqual(found(JAXRS, '/spl-banking/accounts/123-456/transactions?from=2024-01-01'), ['GET transactions suffix']);
  assert.deepStrictEqual(found(JAXRS, '/accounts/123-456/close'), ['POST close exact']);

  // The "braces inside text" line doesn't cut getPortfolio short, and the helper isn't an endpoint.
  const lines = sample(SPRING).split(/\r?\n/);
  const get = analyse(sample(SPRING), '/enq/customer/portfolio/1').matches.find(m => m.methodName === 'getPortfolio');
  assert.match(lines[get.endLine - 1], /^ {4}\}$/);
  assert.match(lines.slice(get.startLine - 1, get.endLine).join('\n'), /^ {4}\/\*\*[\s\S]*braces inside text[\s\S]*return PortfolioResponseBuilder\.portfolio/);
  assert.ok(!analyse(sample(SPRING), '').endpoints.some(e => e.methodName === 'auditTrail'));

  const list = toEntries(readCsv(sample('demo-list.csv'))).entries;
  assert.deepStrictEqual(list.map(e => `${e.baseUrl} ${e.project}/${e.repo}`),
    ['http://127.0.0.1:5199 DEMO/ecomm-services', 'http://127.0.0.1:5199 DEMO/enterprise-services']);
});

test('mock Bitbucket serves the demo files through server.py', { skip: !python && 'Python 3.7+ not available' }, async () => {
  const start = (args, ready) => new Promise((resolve, reject) => {
    const child = spawn(python, ['-u', ...args]);
    let out = '';
    const timer = setTimeout(() => reject(new Error(`did not start:\n${out}`)), 10000);
    const onData = d => { out += d; if (out.includes(ready)) { clearTimeout(timer); resolve(child); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
  const mock = await start([path.join(__dirname, '..', 'tools', 'mock_bitbucket.py'), '--port', '5198'], 'Mock Bitbucket at');
  const app = await start([path.join(__dirname, '..', 'server.py'), '--port', '5195', '--proxy', 'direct'], 'Proxy mode');
  const get = (url, password = 'demo') => fetch('http://127.0.0.1:5195/api/get', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, connection: { baseUrl: 'http://127.0.0.1:5198', user: 'tester', password } }),
  }).then(r => r.json());
  try {
    const base = { baseUrl: 'http://127.0.0.1:5198', project: 'DEMO', repo: 'ecomm-services', path: 'src/main/java/com/example/ecomm/enq', fileName: 'CustomerPortfolioEndpoint', extension: '.java' };
    const loc = resolveLocation(buildFileUrl(base), { baseUrl: base.baseUrl });
    const file = await get(loc.rawUrl);
    assert.strictEqual(file.status, 200);
    assert.strictEqual(file.body, sample(SPRING));
    assert.strictEqual((await get(loginCheckUrl(base))).status, 200);
    assert.strictEqual((await get(loginCheckUrl(base), 'wrong')).status, 401);
    const missing = resolveLocation(buildFileUrl({ ...base, fileName: 'Missing' }), { baseUrl: base.baseUrl });
    assert.strictEqual((await get(missing.rawUrl)).status, 404);
    const escape = resolveLocation('http://127.0.0.1:5198/projects/DEMO/repos/ecomm-services/browse/x.java', { baseUrl: base.baseUrl });
    assert.strictEqual((await get(escape.rawUrl.replace('/raw/x.java', '/raw/..%2F..%2Fserver.py'))).status, 404);
  } finally {
    app.kill();
    mock.kill();
  }
});

// ---- Tracing API path -> Endpoint -> API -> Controller ----

const { traceFlows, findMethods } = require('../public/shared/java');
const API_FILE = 'ecomm-services/src/main/java/com/example/ecomm/enq/controller/CustomerPortfolioApi.java';
const CTL_FILE = 'ecomm-services/src/main/java/com/example/ecomm/enq/controller/CustomerPortfolioController.java';
const flowText = r => `${r.methods.join('|')} ${r.paths.join(',')} | ${r.endpoint ? r.endpoint.name : '-'} -> ` +
  `${r.api.map(c => c.name).join('+') || '-'} -> ${r.controller.map(c => c.name).join('+') || '-'}`;

test('findMethods finds declarations, not calls, ifs or object creation', () => {
  const src = [
    'public class C {',
    '  private final Foo foo = new Foo(1);',
    '  /** Doc. */',
    '  @Override',
    '  public <T> List<T> list(Map<String, List<T>> in) throws IOException, X {',
    '    if (in.isEmpty()) { return new ArrayList<>(); }',
    '    for (String k : in.keySet()) foo.bar(k);',
    '    return helper(in);',
    '  }',
    '  abstract void later(int a);',
    '  C(int x) { this.x = x; }',
    '}',
  ].join('\n');
  // A constructor without a modifier (C(int x)) isn't listed; constructors never take part in links.
  assert.deepStrictEqual(findMethods(src).map(m => `${m.name} ${m.startLine}-${m.endLine}`), ['list 3-9', 'later 10-10']);
});

test('the API path leads through the demo Endpoint to the API and Controller methods', () => {
  const flow = apiPath => traceFlows({ endpoint: sample(SPRING), api: sample(API_FILE), controller: sample(CTL_FILE), apiPath });
  const text = r => `${r.match} ${flowText(r)}`;
  assert.deepStrictEqual(flow('/spl-banking/enq/customer/portfolio/12345').rows.map(text), [
    'suffix GET /enq/customer/portfolio/{customerId} | getPortfolio -> getPortfolio -> getPortfolio',
    'suffix POST /enq/customer/portfolio/{customerId} | updatePortfolio -> validate+savePortfolio -> validate+savePortfolio',
  ]);
  assert.deepStrictEqual(flow('/enq/customer/overview').rows.map(text), ['exact GET|POST /enq/customer/overview | summary -> summary -> summary']);
  assert.deepStrictEqual(flow('/enq/customer/portfolio/1/export').rows.map(text), ['exact GET /enq/customer/portfolio/{customerId}/export | exportPortfolio -> exportCsv -> exportCsv']);
  assert.deepStrictEqual(flow('/enq/customer/unknown').rows, []);
  assert.strictEqual(flow('').rows.length, 5);  // no API: every mapping in the Endpoint
  assert.deepStrictEqual(flow('').classes, { endpoint: 'CustomerPortfolioEndpoint', api: 'CustomerPortfolioApi', controller: 'CustomerPortfolioController', command: null, builder: null });

  // Sections cover the whole method; the Endpoint's calls on portfolioApi are marked, not audit.log().
  const get = flow('/enq/customer/portfolio/1').rows[0];
  const epLines = sample(SPRING).split(/\r?\n/);
  assert.match(epLines[get.endpoint.startLine - 1], /^ {4}\/\*\*/);
  assert.match(epLines[get.endpoint.endLine - 1], /^ {4}\}$/);
  assert.deepStrictEqual(get.callLines.map(n => epLines[n - 1].trim()), ['return PortfolioResponseBuilder.portfolio(portfolioApi.getPortfolio(customerId, currency));']);
  const apiLines = sample(API_FILE).split(/\r?\n/);
  assert.match(apiLines[get.api[0].startLine - 1], /Loads a portfolio/);
  const ctlLines = sample(CTL_FILE).split(/\r?\n/);
  assert.match(ctlLines[get.controller[0].startLine - 1], /Loads a portfolio/);
  assert.match(ctlLines[get.controller[0].declLine - 1], /public Portfolio getPortfolio/);
});

test('tracing with missing files and without typed fields', () => {
  // Only the Endpoint and the API; the Controller not pulled.
  const onlyApi = traceFlows({ endpoint: sample(SPRING), api: sample(API_FILE), apiPath: '/enq/customer/summary' }).rows.map(flowText);
  assert.deepStrictEqual(onlyApi, ['GET|POST /enq/customer/summary | summary -> summary -> -']);

  // The Endpoint holds the Controller directly (no API file).
  const ep = '@RestController\npublic class E {\n  private final Ctl ctl;\n  @GetMapping("/x")\n  public R x() { return ctl.find(1); }\n}';
  const ctl = 'public class Ctl {\n  public R find(int id) { return null; }\n}';
  assert.deepStrictEqual(traceFlows({ endpoint: ep, controller: ctl }).rows.map(flowText), ['GET /x | x -> - -> find']);

  // No variable of either type (the object is looked up): calls to methods those files have.
  const lookup = '@RestController\npublic class E {\n  @GetMapping("/x")\n  public R x() { return Beans.get().find(1); }\n}';
  assert.deepStrictEqual(traceFlows({ endpoint: lookup, controller: ctl }).rows.map(flowText), ['GET /x | x -> - -> find']);

  // No Endpoint: nothing to start from.
  assert.deepStrictEqual(traceFlows({ api: sample(API_FILE), controller: sample(CTL_FILE) }).rows, []);
});

// ---- Route file ----

const { findRouteLines, findRouteSections } = require('../public/shared/java');
const ROUTES = 'ecomm-services/src/main/resources/routes/portfolio-routes.xml';    // Camel style: <from uri="…_name"/>
const GATEWAY = 'ecomm-services/src/main/resources/routes/gateway-routes.xml';    // path patterns

test('the route file lines for an API: path patterns, with the context path on either side', () => {
  const xml = sample(GATEWAY);
  const lines = xml.split(/\r?\n/);
  const ids = api => findRouteLines(xml, api, ['CustomerPortfolioEndpoint']).lines.map(n => (lines[n - 1].match(/id="([^"]+)"/) || [])[1]);
  assert.deepStrictEqual(ids('/spl-banking/enq/customer/portfolio/12345'), ['portfolio-get', 'portfolio-update']);  // * = one segment
  assert.deepStrictEqual(ids('/enq/customer/portfolio/12345'), ['portfolio-get', 'portfolio-update']);              // no /spl-banking typed
  assert.deepStrictEqual(ids('/enq/customer/portfolio/1/holdings/H-9'), ['portfolio-holding-delete']);
  assert.deepStrictEqual(ids('/spl-banking/enq/customer/portfolio/9/export?x=1'), ['portfolio-export']);          // {customerId}, query ignored
  assert.deepStrictEqual(ids('/spl-banking/enq/customer/a/b/summary'), ['portfolio-summary']);                   // ** = any segments
  assert.deepStrictEqual(ids('/accounts/123/balance'), ['account-balance']);
  assert.deepStrictEqual(findRouteLines(xml, '/enq/customer/unknown', ['CustomerPortfolioEndpoint']), { lines: [], how: null });

  // No API: the lines naming the Endpoint class.
  const byName = findRouteLines(xml, '', ['CustomerPortfolioEndpoint']);
  assert.strictEqual(byName.how, 'name');
  assert.strictEqual(byName.lines.length, 5);

  // A file without path patterns: the longest run of the API path, three segments at least.
  const props = 'route.portfolio.url=enq/customer/portfolio\nroute.summary.url=enq/customer/summary\nother=enq/customer';
  assert.deepStrictEqual(findRouteLines(props, '/spl-banking/enq/customer/portfolio/12345'), { lines: [1], how: 'text' });
  assert.deepStrictEqual(findRouteLines(props, '/enq/customer/x'), { lines: [], how: null });  // "enq/customer" alone is too common
});

// ---- Command ----

const CMD_FILE = 'ecomm-services/src/main/java/com/example/ecomm/enq/command/CustomerPortfolioCommand.java';

test('the demo chain continues from the Controller into the Command', () => {
  const { rows, classes } = traceFlows({ endpoint: sample(SPRING), api: sample(API_FILE), controller: sample(CTL_FILE), command: sample(CMD_FILE) });
  assert.strictEqual(classes.command, 'CustomerPortfolioCommand');
  assert.deepStrictEqual(rows.map(r => `${r.endpoint.name} -> ${r.controller.map(c => c.name).join('+')} -> ${r.command.map(c => c.name).join('+')} (${r.commandFrom})`), [
    'getPortfolio -> getPortfolio -> enquire (controller)',
    'updatePortfolio -> validate+savePortfolio -> update (controller)',
    'summary -> summary -> summarise (controller)',
    'removeHolding -> removeHolding -> deleteHolding (controller)',
    'exportPortfolio -> exportCsv -> holdings (controller)',
  ]);
  const ctlLines = sample(CTL_FILE).split(/\r?\n/);
  assert.deepStrictEqual(rows[0].commandCallLines.map(n => ctlLines[n - 1].trim()), ['Portfolio portfolio = command.enquire(customerId);']);
  const cmdLines = sample(CMD_FILE).split(/\r?\n/);
  assert.match(cmdLines[rows[0].command[0].startLine - 1], /Host enquiry: the portfolio/);
  assert.match(cmdLines[rows[0].command[0].endLine - 1], /^ {4}\}$/);
});

test('a Command called straight from the Endpoint, through a field or a new object', () => {
  const cmd = 'public class Cmd {\n  public R run(int id) { return null; }\n}';
  const viaField = '@RestController\npublic class E {\n  private final Cmd cmd;\n  @GetMapping("/x")\n  public R x() { return cmd.run(1); }\n}';
  const viaNew = '@RestController\npublic class E {\n  @GetMapping("/x")\n  public R x() { return new Cmd(host).run(1); }\n}';
  for (const ep of [viaField, viaNew]) {
    const [row] = traceFlows({ endpoint: ep, command: cmd }).rows;
    assert.deepStrictEqual([row.command.map(c => c.name), row.commandFrom, row.commandCallLines], [['run'], 'endpoint', [ep.split('\n').findIndex(l => l.includes('.run(')) + 1]]);
  }
  // No Command file: nothing to look up.
  assert.deepStrictEqual(traceFlows({ endpoint: viaField }).rows[0].command, []);
});

// ---- Builder ----

const BUILDER_FILE = 'ecomm-services/src/main/java/com/example/ecomm/enq/builder/PortfolioResponseBuilder.java';

test('Builder calls are found in the Endpoint and the Controller, including static calls', () => {
  const { rows, classes } = traceFlows({
    endpoint: sample(SPRING), api: sample(API_FILE), controller: sample(CTL_FILE), command: sample(CMD_FILE), builder: sample(BUILDER_FILE),
  });
  assert.strictEqual(classes.builder, 'PortfolioResponseBuilder');
  assert.deepStrictEqual(rows.map(r => `${r.endpoint.name}: ${r.builder.map(b => b.name).join('+') || '-'} ${JSON.stringify(r.builderCallLines)}`), [
    'getPortfolio: portfolio {"endpoint":[40],"controller":[]}',
    'updatePortfolio: noContent {"endpoint":[48],"controller":[]}',
    'summary: - {"endpoint":[],"controller":[]}',
    'removeHolding: - {"endpoint":[],"controller":[]}',
    'exportPortfolio: csv {"endpoint":[],"controller":[51]}',
  ]);
  const epLines = sample(SPRING).split(/\r?\n/);
  assert.match(epLines[39], /PortfolioResponseBuilder\.portfolio\(/);
  const ctlLines = sample(CTL_FILE).split(/\r?\n/);
  assert.match(ctlLines[50], /PortfolioResponseBuilder\.csv\(/);
  // The Command step is unchanged by the Builder.
  assert.deepStrictEqual(rows.map(r => r.command.map(c => c.name).join('+')), ['enquire', 'update', 'summarise', 'deleteHolding', 'holdings']);

  // A Builder held in a field, and one created with new.
  const builder = 'public class B {\n  public R build(Object o) { return null; }\n}';
  const viaField = '@RestController\npublic class E {\n  private final B builder;\n  @GetMapping("/x")\n  public R x() { return builder.build(1); }\n}';
  const viaNew = '@RestController\npublic class E {\n  @GetMapping("/x")\n  public R x() { return new B().build(1); }\n}';
  for (const ep of [viaField, viaNew]) assert.deepStrictEqual(traceFlows({ endpoint: ep, builder }).rows[0].builder.map(b => b.name), ['build']);
});

// ---- Process diagram ----

const Diagram = require('../public/shared/diagram');

function demoGraph(apiPath) {
  const flows = traceFlows({
    endpoint: sample(SPRING), api: sample(API_FILE), controller: sample(CTL_FILE),
    command: sample(CMD_FILE), builder: sample(BUILDER_FILE), apiPath,
  });
  const sections = findRouteSections(sample(ROUTES), flows.rows.map(r => r.endpoint.name));
  for (const r of flows.rows) r.routes = sections[r.endpoint.name] || [];
  return { flows, graph: Diagram.flowGraph({ rows: flows.rows, apiPath }) };
}

test('the process diagram has a box per step and an arrow per call', () => {
  const { flows, graph } = demoGraph('/spl-banking/enq/customer/portfolio/12345');
  const label = id => { const n = graph.nodes.find(x => x.id === id); return `${n.layer}:${n.label}`; };
  assert.deepStrictEqual(graph.edges.map(e => `${label(e.from)} > ${label(e.to)} [${e.kind}] rows ${e.rows}`), [
    'start:/spl-banking/enq/customer/portfolio/12345 > endpoint:getPortfolio() [route] rows 0',
    'endpoint:getPortfolio() > route:ecomm.portfolio.get [route] rows 0',
    'route:ecomm.portfolio.get > api:getPortfolio() [call] rows 0',
    'api:getPortfolio() > controller:getPortfolio() [implements] rows 0',
    'controller:getPortfolio() > command:enquire() [call] rows 0',
    'endpoint:getPortfolio() > builder:portfolio() [response] rows 0',
    'start:/spl-banking/enq/customer/portfolio/12345 > endpoint:updatePortfolio() [route] rows 1',
    'endpoint:updatePortfolio() > route:ecomm.portfolio.update [route] rows 1',
    'route:ecomm.portfolio.update > api:validate() [call] rows 1',
    'route:ecomm.portfolio.update > api:savePortfolio() [call] rows 1',
    'api:validate() > controller:validate() [implements] rows 1',
    'api:savePortfolio() > controller:savePortfolio() [implements] rows 1',
    'controller:savePortfolio() > command:update() [call] rows 1',
    'endpoint:updatePortfolio() > builder:noContent() [response] rows 1',
  ]);
  assert.strictEqual(graph.edges.find(e => e.to.startsWith('api:') && e.rows.includes(1)).label, 'in updatePortfolio(): portfolioApi.validate()');
  // Boxes know where their code is.
  const enquire = graph.nodes.find(n => n.label === 'enquire()');
  assert.deepStrictEqual(enquire.ref, { pane: 'command', line: flows.rows[0].command[0].declLine });

  // The SVG: a lane per layer, the selected row on, the other dimmed, and clickable boxes.
  const svg = Diagram.toSvg(graph, { lanes: flows.classes, selected: 1 });
  assert.deepStrictEqual([...svg.matchAll(/dg-lane-title">([^<]+)</g)].map(m => m[1]), ['Request', 'Endpoint', 'Route', 'API', 'Controller', 'Command', 'Builder']);
  for (const lane of ['Request', 'Endpoint', 'Route', 'API', 'Controller', 'Command', 'Builder']) assert.match(svg, new RegExp(`dg-lane-title">${lane}<`));
  assert.match(svg, /class="dg-node dg-endpoint dg-on"[^>]*data-pane="endpoint"/);
  assert.match(svg, /class="dg-node dg-command dg-off"/);  // enquire() belongs to row 0
  assert.strictEqual((svg.match(/dg-response/g) || []).length, 2);
  assert.ok(!/<script/i.test(svg));
});

test('the process diagram without a route file, and with nothing to draw', () => {
  const flows = traceFlows({ endpoint: sample(SPRING), controller: sample(CTL_FILE), apiPath: '/enq/customer/summary' });
  const graph = Diagram.flowGraph({ rows: flows.rows, apiPath: '/enq/customer/summary' });
  assert.deepStrictEqual(graph.edges.map(e => `${e.from} > ${e.to.split(':')[0]} [${e.kind}]`), [
    'start > endpoint [route]', `endpoint:${flows.rows[0].endpoint.declLine} > controller [call]`,
  ]);
  assert.deepStrictEqual(Diagram.flowGraph({ rows: [] }), { nodes: [], edges: [] });
  // Route entries attach to Endpoint methods by name, else by HTTP method.
  const rows = [{ endpoint: { name: 'a' }, methods: ['GET'] }, { endpoint: { name: 'b' }, methods: ['POST'] }];
  assert.strictEqual(Diagram.routeFits('<route path="/x"> <target operation="b"/>', rows[0], rows), false);
  assert.strictEqual(Diagram.routeFits('<route path="/x"> <target operation="b"/>', rows[1], rows), true);
  assert.strictEqual(Diagram.routeFits('<route method="POST" path="/x">', rows[0], rows), false);
  assert.strictEqual(Diagram.routeFits('route.x=/x', rows[0], rows), true);
  assert.strictEqual(Diagram.routeLabel('<route id="portfolio-get" path="/a/b">'), 'portfolio-get');
});

test('the route for an Endpoint method: <from uri="…_name"/> inside a <route>', () => {
  const xml = sample(ROUTES);
  const lines = xml.split(/\r?\n/);
  const found = findRouteSections(xml, ['getPortfolio', 'updatePortfolio', 'summary', 'notThere']);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.map(x => x.id)])), {
    getPortfolio: ['ecomm.portfolio.get'],         // not _getPortfolioHistory, not the commented-out route
    updatePortfolio: ['ecomm.portfolio.update'],
    summary: ['ecomm.portfolio.summary'],
    notThere: [],
  });
  const get = found.getPortfolio[0];
  assert.match(lines[get.start - 1], /<route id="ecomm\.portfolio\.get">/);
  assert.match(lines[get.end - 1], /<\/route>/);
  assert.match(lines[get.fromLine - 1], /<from uri="direct:ecomm\.portfolio_getPortfolio"\/>/);
  assert.strictEqual(get.uri, 'direct:ecomm.portfolio_getPortfolio');
  // A nested <choice> doesn't end the route early.
  assert.match(lines[found.updatePortfolio[0].end - 1], /<\/route>/);
  assert.ok(found.updatePortfolio[0].end - found.updatePortfolio[0].start >= 8);

  // An opening tag over several lines, a <from> elsewhere in the route, and a mention outside <from>.
  const xml2 = [
    '<routes>',
    '  <route',
    '      id="submit.route" streamCache="true">',
    '    <description>handles direct:x.y_processSubmitApi</description>',
    '    <from uri="direct:xx.xx_processSubmitApi"/>',
    '  </route>',
    '  <route id="other"><from uri="direct:xx.xx_processSubmitApiV2"/></route>',
    '</routes>',
  ].join('\n');
  assert.deepStrictEqual(findRouteSections(xml2, ['processSubmitApi']).processSubmitApi,
    [{ id: 'submit.route', start: 2, end: 6, fromLine: 5, uri: 'direct:xx.xx_processSubmitApi' }]);
});

test('API and Controller methods with the Endpoint method\'s own name win over the calls it makes', () => {
  const ep = [
    '@RestController',
    'public class SubmitEndpoint {',
    '  private final SubmitApi api;',
    '  @PostMapping("/submit")',
    '  public R processSubmitApi(@RequestBody Req req) {',
    '    api.validate(req);',
    '    return api.processSubmitApi(req);',
    '  }',
    '}',
  ].join('\n');
  const apiFile = 'public interface SubmitApi {\n  void validate(Req req);\n  /** Submits. */\n  R processSubmitApi(Req req);\n}';
  const ctl = [
    'public class SubmitController implements SubmitApi {',
    '  public void validate(Req req) { }',
    '  @Override',
    '  public R processSubmitApi(Req req) {',
    '    return cmd.run(req);',
    '  }',
    '  public R processSubmitApiV2(Req req) { return null; }',
    '}',
  ].join('\n');
  const [row] = traceFlows({ endpoint: ep, api: apiFile, controller: ctl, apiPath: '/submit' }).rows;
  assert.deepStrictEqual([row.api.map(m => m.name), row.controller.map(m => m.name)], [['processSubmitApi'], ['processSubmitApi']]);
  assert.deepStrictEqual(row.linkedBy, { api: 'name', controller: 'name' });
  // Only that method's section: the API method with its Javadoc, the Controller one with @Override.
  assert.deepStrictEqual([row.api[0].startLine, row.api[0].endLine], [3, 4]);
  assert.deepStrictEqual([row.controller[0].startLine, row.controller[0].endLine], [3, 6]);
  // The Endpoint line calling the shared name is marked; api.validate() is not followed.
  assert.deepStrictEqual(row.callLines, [7]);

  // A Controller without a method of that name: the calls are followed there instead.
  const ctl2 = 'public class SubmitController implements SubmitApi {\n  public void validate(Req req) { }\n  public R submit(Req req) { return null; }\n}';
  const [row2] = traceFlows({ endpoint: ep.replace('api.processSubmitApi(req)', 'ctl.submit(req)').replace('private final SubmitApi api;', 'private final SubmitApi api;\n  private final SubmitController ctl;'), api: apiFile, controller: ctl2, apiPath: '/submit' }).rows;
  assert.deepStrictEqual(row2.linkedBy, { api: 'name', controller: 'call' });
  assert.deepStrictEqual(row2.controller.map(m => m.name), ['validate', 'submit']);
});
