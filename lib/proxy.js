'use strict';

// The only thing the server does for the page: an authenticated GET to Bitbucket.
// server.ps1 implements the same rules for laptops without Node.js.

const MAX_BYTES = 5 * 1024 * 1024;

class ProxyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// The login may only ever be sent to the Bitbucket host the user typed (plus the Cloud API host).
function checkTarget(url, baseUrl) {
  if (!/^https?:\/\/[^/\s]+/i.test(baseUrl || '')) throw new ProxyError('The Bitbucket URL must start with http:// or https://.');
  if (!/^https?:\/\//i.test(url || '')) throw new ProxyError('Only http(s) URLs can be fetched.');
  const host = new URL(url).hostname.toLowerCase();
  const baseHost = new URL(baseUrl).hostname.toLowerCase();
  const cloud = /(^|\.)bitbucket\.org$/.test(baseHost);
  if (host !== baseHost && !(cloud && host === 'api.bitbucket.org')) {
    throw new ProxyError(`Refusing to send the login to "${host}": it is not the Bitbucket host "${baseHost}".`, 403);
  }
}

function authHeader(cfg) {
  if (!cfg.token) return {};
  if (cfg.user) return { Authorization: 'Basic ' + Buffer.from(`${cfg.user}:${cfg.token}`).toString('base64') };
  return { Authorization: `Bearer ${cfg.token}` };
}

// Returns { status, contentType, body } for any HTTP reply; throws only when Bitbucket can't be reached.
async function proxyGet(url, cfg, fetchImpl = fetch) {
  checkTarget(url, cfg.baseUrl);
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'text/plain, application/json, */*', ...authHeader(cfg) },
      redirect: 'follow',
      signal: AbortSignal.timeout(cfg.timeoutMs || 20000),
    });
  } catch (err) {
    const cause = err.cause && err.cause.code ? ` (${err.cause.code})` : '';
    throw new ProxyError(`Could not reach Bitbucket at ${new URL(url).host}${cause}: ${err.message}`, 502);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new ProxyError('File is larger than 5 MB.', 413);
  return { status: res.status, contentType: res.headers.get('content-type') || '', body: buf.toString('utf8') };
}

module.exports = { proxyGet, checkTarget, ProxyError };
