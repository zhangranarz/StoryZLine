'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchFile, checkLogin, LocationError } = require('./lib/bitbucket');
const { analyse } = require('./lib/java');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnv(path.join(__dirname, '.env'));

const cfg = {
  baseUrl: process.env.BITBUCKET_BASE_URL || '',
  token: process.env.BITBUCKET_TOKEN || '',
  user: process.env.BITBUCKET_USER || '',
  project: process.env.BITBUCKET_PROJECT || '',
  repo: process.env.BITBUCKET_REPO || '',
  branch: process.env.BITBUCKET_BRANCH || '',
  timeoutMs: Number(process.env.BITBUCKET_TIMEOUT_MS) || 20000,
};
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 5180;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 64 * 1024) { reject(new LocationError('Request too large.', 413)); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { reject(new LocationError('Invalid JSON body.')); }
    });
  });
}

// The login typed in the page takes precedence over .env. The password is used for this
// request only and is never stored.
function effectiveCfg(conn) {
  const c = { ...cfg };
  if (!conn || typeof conn !== 'object') return c;
  const pick = k => (typeof conn[k] === 'string' ? conn[k].trim() : '');
  for (const k of ['baseUrl', 'project', 'repo', 'branch']) if (pick(k)) c[k] = pick(k);
  if (pick('user') || conn.password) {
    c.user = pick('user');
    c.token = typeof conn.password === 'string' ? conn.password : '';
  }
  if (c.baseUrl && !/^https?:\/\/[^/\s]+/i.test(c.baseUrl)) {
    throw new LocationError('The Bitbucket URL must start with http:// or https://.');
  }
  return c;
}

// Only the StoryZLine page itself may call the API. This stops other websites open in the
// same browser from using this server (and the login) through cross-site or DNS-rebinding requests.
function fromOwnPage(req) {
  const host = (req.headers.host || '').toLowerCase();
  const allowed = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `${HOST}:${PORT}`.toLowerCase()];
  if (!allowed.includes(host)) return false;
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return false;
  const origin = req.headers.origin;
  return !origin || origin.toLowerCase() === `http://${host}`;
}

async function handleCheck(req, res) {
  const { connection } = await readJson(req);
  send(res, 200, await checkLogin(effectiveCfg(connection)));
}

async function handleFetch(req, res) {
  const { ecommApi, location, connection } = await readJson(req);
  const file = await fetchFile(location, effectiveCfg(connection));
  send(res, 200, {
    ecommApi: ecommApi || '',
    project: file.project,
    repo: file.repo,
    ref: file.ref,
    path: file.path,
    browseUrl: file.browseUrl,
    bytes: file.bytes,
    content: file.content,
    analysis: analyse(file.content, ecommApi),
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url.startsWith('/api/')) {
      if (!fromOwnPage(req)) return send(res, 403, { error: 'Requests must come from the StoryZLine page.' });
      if (req.url === '/api/fetch') return await handleFetch(req, res);
      if (req.url === '/api/check') return await handleCheck(req, res);
      return send(res, 404, { error: 'Not found' });
    }
    if (req.method === 'GET' && req.url === '/api/config') {
      // Never return the token itself.
      return send(res, 200, {
        baseUrl: cfg.baseUrl, project: cfg.project, repo: cfg.repo, branch: cfg.branch,
        tokenSet: Boolean(cfg.token), auth: cfg.token ? (cfg.user ? 'basic' : 'bearer') : 'none',
      });
    }
    if (req.method === 'GET') return serveStatic(req, res);
    send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    const status = err instanceof LocationError ? err.status : 500;
    if (status === 500) console.error(err);
    send(res, status, { error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`StoryZLine running at http://${HOST}:${PORT}`);
  });
}

module.exports = { server, cfg, effectiveCfg };
