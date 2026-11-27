'use strict';

// Turns a user-supplied file location into a Bitbucket raw-content request and fetches it.
// Supports Bitbucket Server / Data Center and Bitbucket Cloud.

const MAX_BYTES = 5 * 1024 * 1024;

class LocationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function isCloud(cfg) {
  return /(^|\.)bitbucket\.org$/i.test(new URL(cfg.baseUrl).hostname);
}

function encodePath(path) {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function cleanPath(path) {
  const p = decodeURIComponent(path).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!p) throw new LocationError('File path is empty.');
  if (p.split('/').some(s => s === '..')) throw new LocationError('File path must not contain "..".');
  return p;
}

// Returns { project, repo, ref, path, browseUrl, rawUrl }.
function resolveLocation(location, cfg) {
  const input = String(location || '').trim();
  if (!input) throw new LocationError('Enter the EndPoint Java file location.');
  if (!cfg.baseUrl) throw new LocationError('Enter the Bitbucket URL in the login section.');

  const base = new URL(cfg.baseUrl);
  const baseStr = cfg.baseUrl.replace(/\/+$/, '');
  const cloud = isCloud(cfg);
  let project, repo, ref, path;

  if (/^https?:\/\//i.test(input)) {
    const u = new URL(input);
    // Only ever send the token to the configured Bitbucket host.
    if (u.hostname.toLowerCase() !== base.hostname.toLowerCase()) {
      throw new LocationError(`URL host "${u.hostname}" does not match the configured Bitbucket host "${base.hostname}".`);
    }
    if (cloud) {
      // https://bitbucket.org/{workspace}/{repo}/src/{ref}/{path}
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:src|raw)\/([^/]+)\/(.+)$/);
      if (!m) throw new LocationError('Unrecognised Bitbucket Cloud URL. Expected https://bitbucket.org/<workspace>/<repo>/src/<branch>/<path>.');
      [, project, repo, ref, path] = m;
      ref = decodeURIComponent(u.searchParams.get('at') || ref);
    } else {
      // https://host[/context]/projects/{P}/repos/{r}/browse/{path}?at=refs/heads/{branch}
      // https://host[/context]/users/{u}/repos/{r}/browse/{path}
      const m = u.pathname.match(/\/(projects|users)\/([^/]+)\/repos\/([^/]+)\/(?:browse|raw)\/(.+)$/);
      if (!m) throw new LocationError('Unrecognised Bitbucket URL. Expected .../projects/<KEY>/repos/<repo>/browse/<path>.');
      project = m[1] === 'users' ? `~${m[2]}` : m[2];
      repo = m[3];
      path = m[4];
      ref = u.searchParams.get('at') || cfg.branch || '';
    }
  } else {
    // A plain path inside the default project/repo from .env.
    if (!cfg.project || !cfg.repo) {
      throw new LocationError('Paste a full Bitbucket file URL, or fill in the default project and repo to use plain paths.');
    }
    project = cfg.project;
    repo = cfg.repo;
    path = input;
    ref = cfg.branch || '';
  }

  path = cleanPath(path);
  const p = encodeURIComponent(project);
  const r = encodeURIComponent(repo);
  let rawUrl, browseUrl;

  if (cloud) {
    if (!ref) throw new LocationError('Bitbucket Cloud needs a branch: fill in the default branch or paste a full URL.');
    rawUrl = `https://api.bitbucket.org/2.0/repositories/${p}/${r}/src/${encodeURIComponent(ref)}/${encodePath(path)}`;
    browseUrl = `${baseStr}/${p}/${r}/src/${encodeURIComponent(ref)}/${encodePath(path)}`;
  } else {
    const at = ref ? `?at=${encodeURIComponent(ref)}` : '';
    rawUrl = `${baseStr}/rest/api/1.0/projects/${p}/repos/${r}/raw/${encodePath(path)}${at}`;
    browseUrl = `${baseStr}/projects/${p}/repos/${r}/browse/${encodePath(path)}${at}`;
  }

  return { project, repo, ref, path, rawUrl, browseUrl };
}

function authHeader(cfg) {
  if (!cfg.token) return {};
  if (cfg.user) return { Authorization: 'Basic ' + Buffer.from(`${cfg.user}:${cfg.token}`).toString('base64') };
  return { Authorization: `Bearer ${cfg.token}` };
}

async function request(url, cfg, fetchImpl, notFound) {
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'text/plain, application/json, */*', ...authHeader(cfg) },
      redirect: 'follow',
      signal: AbortSignal.timeout(cfg.timeoutMs || 20000),
    });
  } catch (err) {
    const cause = err.cause && err.cause.code ? ` (${err.cause.code})` : '';
    throw new LocationError(`Could not reach Bitbucket at ${new URL(url).host}${cause}: ${err.message}`, 502);
  }

  if (!res.ok) {
    const hints = {
      401: 'Bitbucket rejected the login. Check the user ID and password (or access token).',
      403: 'This login has no read access here.',
      404: notFound,
    };
    throw new LocationError(hints[res.status] || `Bitbucket returned HTTP ${res.status} ${res.statusText}.`, res.status === 404 ? 404 : 502);
  }

  const type = res.headers.get('content-type') || '';
  if (/text\/html/i.test(type)) {
    throw new LocationError('Bitbucket returned an HTML page instead of data. Usually this means it redirected to a login page: check the login, or your Bitbucket may require SSO (then use an HTTP access token as the password).', 502);
  }
  return res;
}

// Confirms the URL and login work, without needing a file path.
async function checkLogin(cfg, fetchImpl = fetch) {
  if (!cfg.baseUrl) throw new LocationError('Enter the Bitbucket URL.');
  const url = isCloud(cfg)
    ? 'https://api.bitbucket.org/2.0/user'
    : `${cfg.baseUrl.replace(/\/+$/, '')}/rest/api/1.0/projects?limit=1`;
  await request(url, cfg, fetchImpl, 'No Bitbucket REST API at this URL. Check the Bitbucket URL (include any context path such as /bitbucket).');
  return { ok: true, user: cfg.user || null };
}

async function fetchFile(location, cfg, fetchImpl = fetch) {
  const loc = resolveLocation(location, cfg);
  const res = await request(loc.rawUrl, cfg, fetchImpl,
    `File not found: ${loc.project}/${loc.repo}/${loc.path}${loc.ref ? ` at ${loc.ref}` : ''}.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new LocationError('File is larger than 5 MB.', 413);

  return { ...loc, content: buf.toString('utf8'), bytes: buf.length };
}

module.exports = { resolveLocation, fetchFile, checkLogin, LocationError };
