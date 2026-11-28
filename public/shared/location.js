// Turns a user-supplied file location into a Bitbucket raw-content URL.
// Supports Bitbucket Server / Data Center and Bitbucket Cloud.
// Shared by the browser page and the Node tests, so it must not use Node-only APIs.
(function () {
  'use strict';

  class LocationError extends Error {}

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

  function checkBaseUrl(cfg) {
    if (!cfg.baseUrl) throw new LocationError('Enter the Bitbucket URL in the login section.');
    if (!/^https?:\/\/[^/\s]+/i.test(cfg.baseUrl)) throw new LocationError('The Bitbucket URL must start with http:// or https://.');
  }

  // Returns { project, repo, ref, path, browseUrl, rawUrl }.
  function resolveLocation(location, cfg) {
    const input = String(location || '').trim();
    if (!input) throw new LocationError('Enter the EndPoint Java file location.');
    checkBaseUrl(cfg);

    const base = new URL(cfg.baseUrl);
    const baseStr = cfg.baseUrl.replace(/\/+$/, '');
    const cloud = isCloud(cfg);
    let project, repo, ref, path;

    if (/^https?:\/\//i.test(input)) {
      const u = new URL(input);
      // Only ever send the login to the configured Bitbucket host.
      if (u.hostname.toLowerCase() !== base.hostname.toLowerCase()) {
        throw new LocationError(`URL host "${u.hostname}" does not match the Bitbucket URL host "${base.hostname}".`);
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
      // A plain path inside the default project/repo.
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

  // Joins parts into the Bitbucket "browse" URL of a file:
  // Bitbucket URL + project + repository + location + path + file name + extension (+ branch).
  // extension: added unless the file name already ends with it; "" adds none. Without an
  // extension part, a file name that has no extension gets ".java".
  function buildFileUrl(parts) {
    const cfg = { baseUrl: String(parts.baseUrl || '').trim() };
    checkBaseUrl(cfg);
    const project = String(parts.project || '').trim();
    const repo = String(parts.repo || '').trim();
    const branch = String(parts.branch || '').trim();
    if (!project || !repo) throw new LocationError('Fill in Project and Repository.');
    let name = String(parts.fileName || '').trim().replace(/^[\\/]+/, '');
    if (!name) throw new LocationError('Fill in File.');
    if (parts.extension === undefined) {
      if (!/\.[A-Za-z0-9]+$/.test(name)) name += '.java';
    } else {
      const ext = String(parts.extension).trim().replace(/^\.?/, '.');
      if (ext !== '.') {
        if (!/^\.[A-Za-z0-9_-]+$/.test(ext)) throw new LocationError('Extension may only contain letters, digits, "-" and "_", e.g. .java');
        if (!name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
      }
    }
    const segments = [parts.location, parts.path, name]
      .flatMap(s => String(s || '').replace(/\\/g, '/').split('/'))
      .map(s => s.trim())
      .filter(Boolean);
    if (segments.includes('..')) throw new LocationError('Path must not contain "..".');
    const filePath = segments.map(encodeURIComponent).join('/');
    const base = cfg.baseUrl.replace(/\/+$/, '');
    const p = encodeURIComponent(project);
    const r = encodeURIComponent(repo);
    if (isCloud(cfg)) {
      if (!branch) throw new LocationError('Bitbucket Cloud needs a branch.');
      return `${base}/${p}/${r}/src/${encodeURIComponent(branch)}/${filePath}`;
    }
    // "/" is allowed in a query string; leaving it readable keeps branch names like release/1.2 legible.
    const at = branch ? `?at=${encodeURIComponent(branch).replace(/%2F/gi, '/')}` : '';
    return `${base}/projects/${p}/repos/${r}/browse/${filePath}${at}`;
  }

  // A cheap authenticated request that confirms the URL and login work.
  function loginCheckUrl(cfg) {
    checkBaseUrl(cfg);
    return isCloud(cfg)
      ? 'https://api.bitbucket.org/2.0/user'
      : `${cfg.baseUrl.replace(/\/+$/, '')}/rest/api/1.0/projects?limit=1`;
  }

  // Turns the proxy's reply ({ status, contentType, body }) into an error message, or null if it is usable.
  function responseProblem(reply, notFound) {
    const hints = {
      401: 'Bitbucket rejected the login. Check the user ID and password (or access token).',
      403: 'This login has no read access here.',
      404: notFound,
      407: 'The company proxy asked for a login (407 Proxy Authentication Required). With the Python server, start it with --proxy direct (on the VPN) or --proxy http://user:password@proxy-host:port.',
    };
    if (reply.status < 200 || reply.status >= 300) return hints[reply.status] || `Bitbucket returned HTTP ${reply.status}.`;
    if (/text\/html/i.test(reply.contentType || '')) {
      return 'Bitbucket returned an HTML page instead of data. Usually this means it redirected to a login page: check the login, or your Bitbucket may require SSO (then use an HTTP access token as the password).';
    }
    return null;
  }

  const api = { resolveLocation, buildFileUrl, loginCheckUrl, responseProblem, isCloud, LocationError };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.StoryZLocation = api;
})();
