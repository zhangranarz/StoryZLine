'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchFile, LocationError } = require('./lib/bitbucket');
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

async function handleFetch(req, res) {
  const { ecommApi, location } = await readJson(req);
  const file = await fetchFile(location, cfg);
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
    if (req.method === 'POST' && req.url === '/api/fetch') return await handleFetch(req, res);
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
    if (!cfg.baseUrl) console.warn('BITBUCKET_BASE_URL is not set: copy .env.example to .env and fill it in.');
    if (!cfg.token) console.warn('BITBUCKET_TOKEN is not set: only public repositories will be readable.');
  });
}

module.exports = { server, cfg };
