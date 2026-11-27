'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let last = null;

// Remember the last inputs per browser, purely as a convenience.
const store = {
  get(k) { try { return localStorage.getItem('storyzline.' + k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem('storyzline.' + k, v); } catch { /* storage unavailable */ } },
};
// Login fields remembered between visits. The password is deliberately not in this list.
const CONN_FIELDS = { baseUrl: 'conn-url', user: 'conn-user', project: 'conn-project', repo: 'conn-repo', branch: 'conn-branch' };

$('api').value = store.get('api');
$('location').value = store.get('location');
for (const [k, id] of Object.entries(CONN_FIELDS)) $(id).value = store.get(k);

// Fill any empty fields from .env defaults, if the server has them.
fetch('/api/config').then(r => r.json()).then(c => {
  for (const [k, id] of Object.entries(CONN_FIELDS)) if (!$(id).value && c[k]) $(id).value = c[k];
  if ($('conn-project').value || $('conn-repo').value) $('defaults').open = true;
  updateState();
}).catch(() => setConnStatus('Server not reachable. Is StoryZLine running?', true));

let loggedIn = false;

function connection() {
  const c = { password: $('conn-pass').value };
  for (const [k, id] of Object.entries(CONN_FIELDS)) c[k] = $(id).value.trim();
  return c;
}

function updateState() {
  const c = connection();
  const el = $('conn-state');
  if (loggedIn) { el.textContent = `✓ logged in as ${c.user}`; el.className = 'state ok'; }
  else if (!c.baseUrl || !c.user || !c.password) { el.textContent = 'not logged in'; el.className = 'state'; }
  else { el.textContent = 'not checked yet'; el.className = 'state'; }
}

function setConnStatus(text, isError = false) {
  $('conn-status').textContent = text;
  $('conn-status').className = isError ? 'error' : '';
}

for (const id of ['conn-url', 'conn-user', 'conn-pass']) {
  $(id).addEventListener('input', () => { loggedIn = false; updateState(); });
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

$('conn').addEventListener('submit', async e => {
  e.preventDefault();
  const c = connection();
  for (const [k, id] of Object.entries(CONN_FIELDS)) store.set(k, c[k]);
  setConnStatus('Checking login…');
  $('login').disabled = true;
  try {
    await post('/api/check', { connection: c });
    loggedIn = true;
    setConnStatus('');
    $('location').focus();
  } catch (err) {
    loggedIn = false;
    setConnStatus(err.message, true);
  } finally {
    $('login').disabled = false;
    updateState();
  }
});

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const ecommApi = $('api').value.trim();
  const location = $('location').value.trim();
  store.set('api', ecommApi);
  store.set('location', location);
  const conn = connection();
  if (!conn.baseUrl || !conn.user || !conn.password) {
    setStatus('Fill in the Bitbucket login above first.', true);
    $(!conn.baseUrl ? 'conn-url' : !conn.user ? 'conn-user' : 'conn-pass').focus();
    return;
  }
  for (const [k, id] of Object.entries(CONN_FIELDS)) store.set(k, conn[k]);
  setStatus('Pulling…');
  $('go').disabled = true;
  try {
    const data = await post('/api/fetch', { ecommApi, location, connection: conn });
    loggedIn = true;
    updateState();
    last = data;
    render(data);
    setStatus(`Loaded ${data.content.split('\n').length} lines (${(data.bytes / 1024).toFixed(1)} KB).`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $('go').disabled = false;
  }
});

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').className = isError ? 'error' : '';
}

function render(d) {
  const a = d.analysis;
  $('result').hidden = false;
  $('file-name').textContent = d.path.split('/').pop();
  $('file-where').textContent = `${d.project}/${d.repo}${d.ref ? ' @ ' + d.ref : ''} · ${d.path}${a.packageName ? ' · package ' + a.packageName : ''}`;
  $('open').href = d.browseUrl;

  const matchLines = new Set(a.matches.flatMap(m => [m.line, m.declLine]));
  const hitLines = new Set(a.textHits);
  $('code').innerHTML = d.content.split(/\r?\n/).map((line, i) => {
    const n = i + 1;
    const cls = matchLines.has(n) ? ' match' : hitLines.has(n) ? ' hit' : '';
    return `<span class="ln${cls}" id="L${n}" data-n="${n}">${esc(line) || ' '}</span>`;
  }).join('');

  let html;
  if (!d.ecommApi) {
    html = '<span class="muted">No eCommAPI given: showing the file only.</span>';
  } else if (a.matches.length) {
    html = a.matches.map(m =>
      `<div><span class="pill ${m.match}">${m.match === 'exact' ? 'Exact match' : 'Matches end of eCommAPI'}</span>
        ${esc(m.methods.join(', '))} <code>${esc(m.path)}</code> →
        <span class="ep-link" data-line="${m.declLine}">${esc((m.className ? m.className + '.' : '') + (m.methodName || '?'))}()</span>
        <span class="muted">line ${m.declLine}</span></div>`).join('');
  } else {
    html = `<span class="pill none">No mapping matched</span> <code>${esc(a.normalisedApi)}</code>` +
      (a.textHits.length ? ` <span class="muted">· text found on line(s) ${a.textHits.slice(0, 20).map(n => `<span class="ep-link" data-line="${n}">${n}</span>`).join(', ')}</span>` : '');
  }
  $('match').innerHTML = html;

  const tbody = $('eps').querySelector('tbody');
  tbody.innerHTML = a.endpoints.length
    ? a.endpoints.flatMap(ep => ep.paths.map(p =>
        `<tr><td>${esc(ep.methods.join(', '))}</td><td><code>${esc(p)}</code></td>
         <td><span class="ep-link" data-line="${ep.declLine}">${esc(ep.methodName || '?')}</span></td><td>${ep.declLine}</td></tr>`)).join('')
    : '<tr><td colspan="4" class="muted">No Spring or JAX-RS mappings found.</td></tr>';
  $('eps').querySelector('summary').textContent = `Endpoints found in this file (${a.endpoints.length})`;

  const first = a.matches[0] ? a.matches[0].declLine : a.textHits[0];
  if (first) jump(first, false);
}

function jump(n, flash = true) {
  const el = $('L' + n);
  if (!el) return;
  const pre = $('code');
  pre.scrollTop = el.offsetTop - pre.clientHeight / 3;
  if (flash) {
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
    pre.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

document.addEventListener('click', e => {
  const t = e.target.closest('.ep-link');
  if (t) jump(Number(t.dataset.line));
});

$('copy').addEventListener('click', async () => {
  if (!last) return;
  try { await navigator.clipboard.writeText(last.content); setStatus('Copied to clipboard.'); }
  catch { setStatus('Clipboard not available in this browser.', true); }
});

$('download').addEventListener('click', () => {
  if (!last) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([last.content], { type: 'text/x-java' }));
  a.download = last.path.split('/').pop();
  a.click();
  URL.revokeObjectURL(a.href);
});
