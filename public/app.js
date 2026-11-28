'use strict';

const $ = id => document.getElementById(id);
const Loc = window.StoryZLocation;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let last = null;

// Remember the last inputs per browser, purely as a convenience.
const store = {
  get(k) { try { return localStorage.getItem('storyzline.' + k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem('storyzline.' + k, v); } catch { /* storage unavailable */ } },
  remove(k) { try { localStorage.removeItem('storyzline.' + k); } catch { /* storage unavailable */ } },
  json(k) { try { return JSON.parse(this.get(k) || 'null'); } catch { return null; } },
};
// Login fields remembered between visits. The password is deliberately not in this list.
const CONN_FIELDS = { baseUrl: 'conn-url', user: 'conn-user', project: 'conn-project', repo: 'conn-repo', branch: 'conn-branch' };

$('api').value = store.get('api');
$('location').value = store.get('location');
for (const [k, id] of Object.entries(CONN_FIELDS)) $(id).value = store.get(k);

// ---- Tabs: "eComm API" (pull a file) and "Settings" (Bitbucket login, Excel list) ----

const TABS = ['api', 'settings'];

function showTab(name, focusTab = false) {
  for (const t of TABS) {
    const on = t === name;
    $('tab-' + t).setAttribute('aria-selected', String(on));
    $('tab-' + t).tabIndex = on ? 0 : -1;
    $('panel-' + t).hidden = !on;
  }
  if (focusTab) $('tab-' + name).focus();
}

for (const t of TABS) $('tab-' + t).addEventListener('click', () => showTab(t));
// Arrow keys switch tabs, as in a native tab bar.
$('tab-api').parentElement.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  showTab($('tab-api').getAttribute('aria-selected') === 'true' ? 'settings' : 'api', true);
});
// Links such as "Open Settings" in the eComm API tab.
document.addEventListener('click', e => {
  const link = e.target.closest('[data-tab]');
  if (link) showTab(link.dataset.tab);
});

// Start in Settings until a Bitbucket server and user ID have been entered once.
showTab($('conn-url').value && $('conn-user').value ? 'api' : 'settings');

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

  // One-line summary of the Settings at the top of the eComm API tab.
  const settingsLink = label => ` <button type="button" class="link" data-tab="settings">${label}</button>`;
  if (!c.baseUrl) {
    $('login-summary').innerHTML = '<span class="warn">No Bitbucket server set yet.</span>' + settingsLink('Open Settings');
    return;
  }
  const repo = c.project && c.repo ? ` · ${esc(c.project)}/${esc(c.repo)}${c.branch ? ' @ ' + esc(c.branch) : ''}` : '';
  const login = loggedIn ? `logged in as <b>${esc(c.user)}</b>`
    : !c.user || !c.password ? '<span class="warn">not logged in</span>'
    : 'login not checked yet';
  $('login-summary').innerHTML = `Bitbucket: <b>${esc(c.baseUrl)}</b>${repo} · ${login} ·` + settingsLink('Settings');
}

function setConnStatus(text, isError = false) {
  $('conn-status').textContent = text;
  $('conn-status').className = isError ? 'error' : '';
}

for (const id of ['conn-url', 'conn-user', 'conn-pass']) {
  $(id).addEventListener('input', () => { loggedIn = false; updateState(); });
}
// Remember the URL and user ID as they are typed (never the password).
$('conn-url').addEventListener('input', () => store.set('baseUrl', $('conn-url').value.trim()));
$('conn-user').addEventListener('input', () => store.set('user', $('conn-user').value.trim()));
for (const id of ['conn-project', 'conn-repo', 'conn-branch']) $(id).addEventListener('input', updateState);
updateState();

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
    const reply = await post('/api/get', { url: Loc.loginCheckUrl(c), connection: c });
    const problem = Loc.responseProblem(reply, 'No Bitbucket REST API at this URL. Check the Bitbucket URL (include any context path such as /bitbucket).');
    if (problem) throw new Error(problem);
    loggedIn = true;
    setConnStatus('');
    showTab('api');
    $($('api').value ? 'location' : 'api').focus();
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
    setStatus('');
    showTab('settings');
    setConnStatus(`Fill in the ${!conn.baseUrl ? 'Bitbucket URL' : !conn.user ? 'user ID' : 'password'} to pull files.`, true);
    $(!conn.baseUrl ? ($('conn-url').hidden ? 'conn-url-select' : 'conn-url') : !conn.user ? 'conn-user' : 'conn-pass').focus();
    return;
  }
  for (const [k, id] of Object.entries(CONN_FIELDS)) store.set(k, conn[k]);
  setStatus('Pulling…');
  $('go').disabled = true;
  try {
    const loc = Loc.resolveLocation(location, conn);
    const reply = await post('/api/get', { url: loc.rawUrl, connection: conn });
    const problem = Loc.responseProblem(reply,
      `File not found: ${loc.project}/${loc.repo}/${loc.path}${loc.ref ? ` at ${loc.ref}` : ''}.`);
    if (problem) {
      if (reply.status === 401) { loggedIn = false; updateState(); }
      throw new Error(problem);
    }
    const data = {
      ...loc, ecommApi, content: reply.body, bytes: new Blob([reply.body]).size,
      analysis: window.StoryZJava.analyse(reply.body, ecommApi),
    };
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

// ---- Excel list ---------------------------------------------------------------------
// The list (no passwords) and the last picks are remembered in this browser.
// It fills the login (Bitbucket URL, project, repository, branch) and builds the file
// location from the endpoint location, path and file name.

const XL = window.StoryZExcel;
const PICK_KEYS = ['project', 'repo', 'branch', 'location'];
const LOGIN_FIELDS = { project: 'conn-project', repo: 'conn-repo', branch: 'conn-branch' };
const OTHER_URL = '__other__';
let pickEntries = [];
let pickColumns = [];

const sameUrl = (a, b) => String(a || '').trim().replace(/\/+$/, '').toLowerCase() ===
  String(b || '').trim().replace(/\/+$/, '').toLowerCase();

function setPickStatus(text, isError = false) {
  $('pick-status').textContent = text;
  $('pick-status').className = isError ? 'error' : '';
}

function setLoginUrl(url) {
  if (sameUrl(url, $('conn-url').value)) return;
  $('conn-url').value = url;
  store.set('baseUrl', url);
  loggedIn = false;
  updateState();
}

// Shows the Excel's Bitbucket URLs as a dropdown in the login, with "Other URL…" for typing one.
// fromNewFile: a freshly loaded list replaces a URL that isn't in it.
function showUrlChoices(fromNewFile) {
  const urls = [...new Set(pickEntries.map(e => e.baseUrl))];
  const sel = $('conn-url-select');
  sel.innerHTML = urls.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('') +
    `<option value="${OTHER_URL}">Other URL…</option>`;
  let match = urls.find(u => sameUrl(u, $('conn-url').value));
  if (!match && (fromNewFile || !$('conn-url').value.trim())) {
    match = urls[0];
    setLoginUrl(match);
  }
  sel.value = match || OTHER_URL;
  sel.hidden = false;
  $('conn-url').hidden = Boolean(match);
  $('conn-url-hint').textContent = urls.length > 1 ? `(${urls.length} in the Excel list)` : '(from the Excel list)';
}

function pickParts() {
  const p = { baseUrl: $('conn-url').value.trim(), path: $('pick-path').value, fileName: $('pick-name').value };
  for (const k of PICK_KEYS) p[k] = $('pick-' + k).value;
  return p;
}

function loadPickList(list, fromNewFile = false) {
  pickEntries = list.entries;
  pickColumns = list.columns;
  $('pick-clear').hidden = false;
  $('pick-state').textContent = `${list.entries.length} row${list.entries.length === 1 ? '' : 's'} from ${list.source}`;
  $('pick-state').className = 'state ok';
  showUrlChoices(fromNewFile);
  const saved = store.json('pickChoice') || {};
  for (const k of PICK_KEYS) $('pick-' + k).dataset.want = saved[k] || '';
  $('pick-path').value = saved.path || '';
  $('pick-name').value = saved.fileName || '';
  refreshPicks();
}

// Shows the Excel pick lists, or the plain login/location fields when there is no list
// (or no rows for the Bitbucket URL in use).
function showExcelFields(on) {
  $('excel-picks').hidden = !on;
  $('build').hidden = !on;
  $('defaults').hidden = on;
  $('location-label').textContent = on
    ? 'Full Bitbucket file URL (built from the picks above; you can still edit it)'
    : 'EndPoint Java file location';
}

// Each pick list only offers values that fit the Bitbucket URL and the picks before it.
function refreshPicks() {
  if (!pickEntries.length) return;
  let rows = pickEntries.filter(e => sameUrl(e.baseUrl, $('conn-url').value));
  showExcelFields(rows.length > 0);
  $('pick-empty').hidden = rows.length > 0;
  if (!rows.length) {
    $('pick-empty').textContent = 'The Excel list has no rows for this Bitbucket URL, so type the project, repository and file location yourself.';
    return;
  }
  for (const k of PICK_KEYS) {
    const sel = $('pick-' + k);
    const current = sel.value || sel.dataset.want || '';
    delete sel.dataset.want;
    const values = [...new Set(rows.map(e => e[k]))];
    sel.innerHTML = values.map(v => `<option value="${esc(v)}">${esc(v || (pickColumns.includes(k) ? '(empty)' : '(not in sheet)'))}</option>`).join('');
    sel.value = values.includes(current) ? current : values[0];
    sel.disabled = !pickColumns.includes(k);
    rows = rows.filter(e => e[k] === sel.value);
    // Keep the login's project / repository / branch in step, so plain paths use them too.
    if (LOGIN_FIELDS[k]) {
      $(LOGIN_FIELDS[k]).value = sel.value;
      store.set(k, sel.value);
    }
  }
  updateState();
  updatePickUrl();
}

// Rebuilds the file location from the picks; leaves it alone until a file name is given.
function updatePickUrl() {
  const parts = pickParts();
  store.set('pickChoice', JSON.stringify(parts));
  const msg = $('build-msg');
  try {
    const url = Loc.buildFileUrl(parts);
    $('location').value = url;
    store.set('location', url);
    msg.hidden = true;
    return url;
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
    return null;
  }
}

function saveFile(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('pick-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  setPickStatus(`Reading ${file.name}…`);
  try {
    if (!/\.(csv|txt)$/i.test(file.name) && typeof DecompressionStream === 'undefined') {
      throw new Error('This browser is too old to read .xlsx files. Save the sheet as CSV in Excel, or use a current Edge or Chrome.');
    }
    const rows = await XL.readTable(file.name, await file.arrayBuffer());
    const list = { ...XL.toEntries(rows), source: file.name };
    store.set('pickList', JSON.stringify(list));
    loadPickList(list, true);
    setPickStatus('');
  } catch (err) {
    setPickStatus(err.message, true);
  }
});

$('conn-url-select').addEventListener('change', e => {
  if (e.target.value === OTHER_URL) {
    $('conn-url').hidden = false;
    $('conn-url').value = '';
    $('conn-url').focus();
  } else {
    $('conn-url').hidden = true;
    setLoginUrl(e.target.value);
  }
  refreshPicks();
});
$('conn-url').addEventListener('input', refreshPicks);

for (const k of PICK_KEYS) $('pick-' + k).addEventListener('change', refreshPicks);
for (const id of ['pick-path', 'pick-name']) $(id).addEventListener('input', updatePickUrl);

$('pick-template').addEventListener('click', () => saveFile('storyzline-list.csv', XL.TEMPLATE_CSV, 'text/csv'));

$('pick-clear').addEventListener('click', () => {
  store.remove('pickList');
  store.remove('pickChoice');
  pickEntries = [];
  showExcelFields(false);
  $('pick-empty').hidden = true;
  $('pick-clear').hidden = true;
  $('pick-state').textContent = '';
  $('conn-url-select').hidden = true;
  $('conn-url').hidden = false;
  $('conn-url-hint').textContent = '';
  setPickStatus('List forgotten. Load another Excel file any time.');
});

const savedList = store.json('pickList');
if (savedList && Array.isArray(savedList.entries) && savedList.entries.length) loadPickList(savedList);
