'use strict';

const $ = id => document.getElementById(id);
const Loc = window.StoryZLocation;
const Java = window.StoryZJava;
const XL = window.StoryZExcel;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Remember the last inputs per browser, purely as a convenience.
const store = {
  get(k) { try { return localStorage.getItem('storyzline.' + k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem('storyzline.' + k, v); } catch { /* storage unavailable */ } },
  remove(k) { try { localStorage.removeItem('storyzline.' + k); } catch { /* storage unavailable */ } },
  json(k) { try { return JSON.parse(this.get(k) || 'null'); } catch { return null; } },
};
// Login fields remembered between visits. The password is deliberately not in this list.
const CONN_FIELDS = { baseUrl: 'conn-url', user: 'conn-user' };
for (const [k, id] of Object.entries(CONN_FIELDS)) $(id).value = store.get(k);

// ---- Tabs: "eComm" (pull and match files) and "Settings" (Bitbucket login, Excel list) ----

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
// Links such as "Open Settings" in the eComm tab.
document.addEventListener('click', e => {
  const link = e.target.closest('[data-tab]');
  if (link) showTab(link.dataset.tab);
});

// Start in Settings until a Bitbucket server and user ID have been entered once.
showTab($('conn-url').value && $('conn-user').value ? 'api' : 'settings');

// ---- Login ----

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

  // One-line summary of the Settings at the top of the eComm tab.
  const settingsLink = label => ` <button type="button" class="link" data-tab="settings">${label}</button>`;
  if (!c.baseUrl) {
    $('login-summary').innerHTML = '<span class="warn">No Bitbucket server set yet.</span>' + settingsLink('Open Settings');
    return;
  }
  const login = loggedIn ? `logged in as <b>${esc(c.user)}</b>`
    : !c.user || !c.password ? '<span class="warn">not logged in</span>'
    : 'login not checked yet';
  $('login-summary').innerHTML = `Bitbucket: <b>${esc(c.baseUrl)}</b> · ${login} ·` + settingsLink('Settings');
}

function setConnStatus(text, isError = false) {
  $('conn-status').textContent = text;
  $('conn-status').className = isError ? 'error' : '';
}

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').className = isError ? 'error' : '';
}

for (const id of ['conn-url', 'conn-user', 'conn-pass']) {
  $(id).addEventListener('input', () => { loggedIn = false; updateState(); });
}
// Remember the URL and user ID as they are typed (never the password).
$('conn-url').addEventListener('input', () => store.set('baseUrl', $('conn-url').value.trim()));
$('conn-user').addEventListener('input', () => store.set('user', $('conn-user').value.trim()));

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
    $('go').focus();
  } catch (err) {
    loggedIn = false;
    setConnStatus(err.message, true);
  } finally {
    $('login').disabled = false;
    updateState();
  }
});

// ---- The Endpoint and APIController boxes ----
// Each joins Bitbucket URL (Settings) / Project / Repository / Path / File / Extension into a
// file URL, with no ?at= branch (Bitbucket then shows the default branch). With an Excel list
// loaded, Project and Repository become dropdowns (plus "Other…" to type a value).

const OTHER = '__other__';
const LEVELS = ['project', 'repo'];  // narrowed in this order
const EXTENSIONS = ['.java', '.xml', '.properties', '.yml', '.yaml', '.json', '.sql', '.wsdl', '.xsd',
  '.kt', '.groovy', '.gradle', '.jsp', '.txt'];
let pickEntries = [];

const sameUrl = (a, b) => String(a || '').trim().replace(/\/+$/, '').toLowerCase() ===
  String(b || '').trim().replace(/\/+$/, '').toLowerCase();

// A box: shared URL / Project / Repository / Path, then one File + Extension pair per file.
class Part {
  // files: [{ key, title, label, placeholder }]: title heads the File box, label names the file elsewhere.
  constructor(key, legend, files) {
    this.key = key;
    this.el = $('part-template').content.firstElementChild.cloneNode(true);
    this.el.querySelector('legend').textContent = legend;
    // One file: URL, Project, Repository, Path, File, Extension on one line, the joined URL below.
    // Several files: URL, Project, Repository, Path on the first line, then a row per file with
    // its File, Extension and joined URL.
    const multi = files.length > 1;
    this.el.querySelector('.parts').style.setProperty('--cols',
      'minmax(6rem, 1.4fr) minmax(6rem, .7fr) minmax(8.5rem, 1fr) minmax(8rem, 2fr)' + (multi ? '' : ' minmax(7rem, 1.3fr) minmax(5.5rem, .7fr)'));
    if (multi) this.el.append(this.$('msg'));
    this.files = files.map(f => {
      const pair = $('file-template').content.cloneNode(true);
      const file = { ...f, name: pair.querySelector('.p-file'), extSelect: pair.querySelector('.p-ext-select'), ext: pair.querySelector('.p-ext') };
      pair.querySelector('.p-file-title').textContent = f.title;
      file.name.placeholder = f.placeholder;
      file.extSelect.innerHTML = EXTENSIONS.map(x => `<option value="${x}">${x}</option>`).join('') +
        `<option value="">(no extension)</option><option value="${OTHER}">Other…</option>`;
      file.ext.value = f.extension || '.java';  // the default until the user picks another
      file.extSelect.value = file.ext.value;
      file.url = document.createElement('input');
      file.url.className = 'p-url endpoint-url';
      file.url.autocomplete = 'off';
      file.url.title = `${f.label} file URL, joined from the parts; you can edit it`;
      file.url.placeholder = `Bitbucket file URL, or a path such as src/main/java/…/${f.placeholder}.java`;
      if (multi) {
        const row = document.createElement('div');
        row.className = 'file-row';
        const urlLabel = document.createElement('label');
        urlLabel.innerHTML = `<span>${esc(f.label)} URL</span>`;
        urlLabel.append(file.url);
        row.append(pair, urlLabel);
        this.$('urls').append(row);
      } else {
        file.url.setAttribute('aria-label', `${f.label} file URL`);
        this.el.querySelector('.parts').append(pair);
        this.$('urls').append(file.url);
      }

      file.extSelect.addEventListener('change', e => {
        if (e.target.value === OTHER) {
          e.target.dataset.other = '1';
          file.ext.value = '';
          file.ext.hidden = false;
          file.ext.focus();
        } else {
          delete e.target.dataset.other;
          file.ext.value = e.target.value;
          file.ext.hidden = true;
        }
        this.update();
      });
      for (const input of [file.name, file.ext]) input.addEventListener('input', () => this.update());
      return file;
    });
    $('sections').append(this.el);

    for (const k of LEVELS) {
      this.$(k + '-select').addEventListener('change', e => {
        const input = this.$(k);
        if (e.target.value === OTHER) {
          e.target.dataset.other = '1';
          input.value = '';
          input.hidden = false;
          input.focus();
        } else {
          delete e.target.dataset.other;
          input.value = e.target.value;
        }
        this.resetAfter(k);
        this.refresh();
      });
      this.$(k).addEventListener('input', () => this.refresh());
    }
    this.$('path').addEventListener('input', () => this.update());
  }

  $(name) { return this.el.querySelector('.p-' + name); }

  // The files to pull: those whose URL is filled in.
  fileUrls() { return this.files.filter(f => f.url.value.trim()).map(f => ({ key: f.key, label: f.label, url: f.url.value.trim(), part: this })); }

  // The settings used to read this box's URLs (its own project and repository).
  cfg(conn) { return { ...conn, project: this.$('project').value.trim(), repo: this.$('repo').value.trim() }; }

  restore(saved) {
    this.$('project').value = saved.project || '';
    this.$('repo').value = saved.repo || '';
    this.$('path').value = saved.path || '';
    const files = saved.files || {};
    for (const f of this.files) {
      const s = files[f.key] || {};
      f.name.value = s.fileName || '';
      if (typeof s.extension === 'string') f.ext.value = s.extension;
      // Show the extension in the dropdown, or under "Other…" when it isn't listed.
      let v = f.ext.value.trim().toLowerCase();
      if (v && !v.startsWith('.')) v = '.' + v;
      f.extSelect.value = v === '' || EXTENSIONS.includes(v) ? v : OTHER;
      f.ext.hidden = f.extSelect.value !== OTHER;
    }
  }

  save() {
    store.set('part.' + this.key, JSON.stringify({
      project: this.$('project').value.trim(), repo: this.$('repo').value.trim(), path: this.$('path').value,
      files: Object.fromEntries(this.files.map(f => [f.key, { fileName: f.name.value, extension: f.ext.value }])),
    }));
  }

  // Clears the levels after `key`, so they fall back to the first value that fits.
  resetAfter(key) {
    for (const k of LEVELS.slice(LEVELS.indexOf(key) + 1)) {
      this.$(k).value = '';
      delete this.$(k + '-select').dataset.other;
    }
  }

  // Fills Project and Repository from the Excel rows for the Bitbucket URL, then rebuilds the URLs.
  refresh() {
    this.$('base').value = $('conn-url').value.trim();
    this.$('base').title = this.$('base').value;  // the box is narrow: show the whole URL on hover
    let rows = pickEntries.filter(e => sameUrl(e.baseUrl, $('conn-url').value));
    for (const k of LEVELS) {
      const sel = this.$(k + '-select');
      const input = this.$(k);
      const values = [...new Set(rows.map(e => e[k]).filter(Boolean))];
      const v = input.value.trim();
      if (values.length) {
        sel.innerHTML = values.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('') +
          `<option value="${OTHER}">Other…</option>`;
        if (values.includes(v)) {
          sel.value = v;
          delete sel.dataset.other;
        } else if (v || sel.dataset.other) {
          sel.value = OTHER;
        } else {
          input.value = values[0];
          sel.value = values[0];
        }
        sel.hidden = false;
        input.hidden = sel.value !== OTHER;
        rows = rows.filter(e => e[k] === input.value.trim());
      } else {
        sel.hidden = true;
        input.hidden = false;
      }
    }
    this.update();
  }

  // Rebuilds each file's URL. It stays as it is (and can be edited) until a part changes.
  update() {
    this.save();
    const problems = [];
    for (const f of this.files) {
      const parts = {
        baseUrl: $('conn-url').value.trim(), project: this.$('project').value, repo: this.$('repo').value,
        path: this.$('path').value, fileName: f.name.value, extension: f.ext.value,
      };
      if (!parts.fileName.trim()) { f.url.value = ''; continue; }  // no file: nothing to pull
      try {
        f.url.value = Loc.buildFileUrl(parts);
      } catch (err) {
        problems.push(this.files.length > 1 ? `${f.title}: ${err.message}` : err.message);
      }
    }
    this.$('msg').textContent = problems.join(' ');
    this.$('msg').hidden = !problems.length;
  }
}

// Saved values from earlier versions: the single-file Endpoint box, and the Controller box.
for (const [from, to, fileKey] of [['part.endpoint', 'part.endpoint', 'endpoint'], ['part.controller', 'part.apictl', 'controller']]) {
  const old = store.json(from);
  if (old && !old.files && !(from !== to && store.json(to))) {
    store.set(to, JSON.stringify({ project: old.project, repo: old.repo, path: old.path, files: { [fileKey]: { fileName: old.fileName, extension: old.extension } } }));
  }
}
if (!store.json('part.endpoint') && (store.json('endpointParts') || store.get('project'))) {
  const old = store.json('endpointParts') || {};
  store.set('part.endpoint', JSON.stringify({ project: store.get('project'), repo: store.get('repo'), path: old.path, files: { endpoint: { fileName: old.fileName, extension: old.extension } } }));
}
for (const k of ['endpointParts', 'project', 'repo', 'location', 'branch', 'pickChoice', 'part.api', 'part.controller']) store.remove(k);

// The eComm API path picks the Endpoint method(s) to follow.
$('api').value = store.get('api');
$('api').addEventListener('input', () => store.set('api', $('api').value.trim()));

const parts = [
  new Part('route', 'Route', [{ key: 'route', title: 'File', label: 'Route', placeholder: 'portfolio-routes', extension: '.xml' }]),
  new Part('endpoint', 'Endpoint', [{ key: 'endpoint', title: 'File', label: 'Endpoint', placeholder: 'CustomerPortfolioEndpoint' }]),
  new Part('apictl', 'APIController', [
    { key: 'api', title: 'API File', label: 'API', placeholder: 'CustomerPortfolioApi' },
    { key: 'controller', title: 'Controller File', label: 'Controller', placeholder: 'CustomerPortfolioController' },
  ]),
];
// A new box starts with the Endpoint's project and repository.
const endpointSaved = store.json('part.endpoint') || {};
for (const p of parts) p.restore(store.json('part.' + p.key) || { project: endpointSaved.project, repo: endpointSaved.repo });
const refreshAll = () => parts.forEach(p => p.refresh());

// ---- Excel list (Settings) ----

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

// Shows the Excel's Bitbucket URLs as a dropdown in Settings, with "Other URL…" for typing one.
// fromNewFile: a freshly loaded list replaces a URL that isn't in it.
function showUrlChoices(fromNewFile) {
  const urls = [...new Set(pickEntries.map(e => e.baseUrl))];
  const sel = $('conn-url-select');
  sel.innerHTML = urls.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('') +
    `<option value="${OTHER}">Other URL…</option>`;
  let match = urls.find(u => sameUrl(u, $('conn-url').value));
  if (!match && (fromNewFile || !$('conn-url').value.trim())) {
    match = urls[0];
    setLoginUrl(match);
  }
  sel.value = match || OTHER;
  sel.hidden = false;
  $('conn-url').hidden = Boolean(match);
}

function loadPickList(list, fromNewFile = false) {
  pickEntries = list.entries;
  $('pick-clear').hidden = false;
  $('pick-state').textContent = `${list.entries.length} row${list.entries.length === 1 ? '' : 's'} from ${list.source}`;
  $('pick-state').className = 'state ok';
  showUrlChoices(fromNewFile);
  if (fromNewFile) parts.forEach(p => p.resetAfter('url'));
  refreshAll();
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
  if (e.target.value === OTHER) {
    $('conn-url').hidden = false;
    $('conn-url').value = '';
    $('conn-url').focus();
  } else {
    $('conn-url').hidden = true;
    setLoginUrl(e.target.value);
  }
  parts.forEach(p => p.resetAfter('url'));  // a new server: start again from its first project and repository
  refreshAll();
});
$('conn-url').addEventListener('input', refreshAll);

$('pick-template').addEventListener('click', () => saveFile('storyzline-list.csv', XL.TEMPLATE_CSV, 'text/csv'));

$('pick-clear').addEventListener('click', () => {
  store.remove('pickList');
  pickEntries = [];
  $('pick-clear').hidden = true;
  $('pick-state').textContent = '';
  $('conn-url-select').hidden = true;
  $('conn-url').hidden = false;
  refreshAll();
  setPickStatus('List forgotten. Load another Excel file any time.');
});

// ---- Pull the files and follow API path -> Endpoint -> API -> Controller ----

const FILE_ORDER = ['route', 'endpoint', 'api', 'controller'];
let view = null;  // { files, flows, selected, panes, whole }

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const conn = connection();
  if (!conn.baseUrl || !conn.user || !conn.password) {
    setStatus('');
    showTab('settings');
    setConnStatus(`Fill in the ${!conn.baseUrl ? 'Bitbucket URL' : !conn.user ? 'user ID' : 'password'} to pull files.`, true);
    $(!conn.baseUrl ? ($('conn-url').hidden ? 'conn-url-select' : 'conn-url') : !conn.user ? 'conn-user' : 'conn-pass').focus();
    return;
  }
  const chosen = parts.flatMap(p => p.fileUrls());
  if (!chosen.length) {
    setStatus('Fill in the Endpoint File (and the API and Controller Files).', true);
    parts[0].files[0].name.focus();
    return;
  }
  setStatus(`Pulling ${chosen.length} file${chosen.length === 1 ? '' : 's'}…`);
  $('go').disabled = true;
  try {
    const results = await Promise.all(chosen.map(async c => {
      let loc;
      try {
        loc = Loc.resolveLocation(c.url, c.part.cfg(conn));
        const reply = await post('/api/get', { url: loc.rawUrl, connection: conn });
        const problem = Loc.responseProblem(reply,
          `File not found: ${loc.project}/${loc.repo}/${loc.path}${loc.ref ? ` at ${loc.ref}` : ''}.`);
        if (problem) return { ...c, loc, error: problem, status: reply.status };
        return { ...c, loc, content: reply.body };
      } catch (err) {
        return { ...c, loc, error: err.message };
      }
    }));
    const ok = results.filter(r => r.content != null);
    if (ok.length) loggedIn = true;
    if (results.some(r => r.status === 401)) loggedIn = false;
    updateState();
    render(results, $('api').value.trim());
    const failed = results.filter(r => r.error);
    setStatus(failed.length
      ? `Pulled ${ok.length} of ${results.length} files. ${failed.map(r => `${r.label}: ${r.error}`).join(' ')}`
      : `Pulled ${ok.length} file${ok.length === 1 ? '' : 's'}.`, failed.length > 0);
  } finally {
    $('go').disabled = false;
  }
});

function render(results, apiPath) {
  const files = Object.fromEntries(results.map(r => [r.key, r]));
  const src = k => (files[k] && files[k].content != null ? files[k].content : null);
  const flows = Java.traceFlows({ endpoint: src('endpoint'), api: src('api'), controller: src('controller'), apiPath });
  // The route file's lines for this API (the same for every row).
  const route = src('route') != null ? Java.findRouteLines(src('route'), apiPath, [flows.classes.endpoint]) : null;
  view = { files, flows, route, selected: 0, panes: {}, whole: {} };
  $('result').hidden = false;

  const none = '<span class="none">—</span>';
  const notPulled = '<span class="none">not pulled</span>';
  const names = list => list.map(m => `${esc(m.name)}()`).join(', ') || none;
  const match = r => (r.match ? `<span class="pill ${r.match}">${r.match === 'exact' ? 'Exact match' : 'Matches end of API'}</span>` : none);
  $('flow').querySelector('tbody').innerHTML = flows.rows.map((r, i) => `
    <tr data-row="${i}" tabindex="0">
      <td>${esc(r.methods.join(', ')) || none}</td>
      <td>${r.paths.map(p => `<code>${esc(p)}</code>`).join('<br>') || none}</td>
      <td>${match(r)}</td>
      <td>${r.endpoint ? `${esc(r.endpoint.name)}()` : none}</td>
      <td>${src('api') != null ? names(r.api) : notPulled}</td>
      <td>${src('controller') != null ? names(r.controller) : notPulled}</td>
    </tr>`).join('') ||
    `<tr><td colspan="6" class="none">${src('endpoint') == null ? 'The Endpoint file was not pulled.' : apiPath ? 'No Endpoint mapping matches this API.' : 'No mappings found in the Endpoint.'}</td></tr>`;

  const linked = flows.rows.filter(r => r.api.length || r.controller.length).length;
  $('flow-state').textContent = flows.rows.length ? `${flows.rows.length} row${flows.rows.length === 1 ? '' : 's'}, ${linked} linked past the Endpoint` : '';
  $('flow-state').className = 'state' + (linked ? ' ok' : '');
  const notes = [];
  if (!apiPath && src('endpoint') != null) notes.push('No API given: listing every mapping in the Endpoint.');
  if (apiPath && src('endpoint') != null && !flows.rows.length) notes.push('Showing the whole Endpoint file.');
  const called = [flows.classes.api, flows.classes.controller].filter(Boolean);
  if (called.length && flows.rows.length && !linked) notes.push(`No calls to ${called.join(' or ')} were found in the Endpoint methods.`);
  if (route) {
    const n = route.lines.length;
    notes.push(!n ? 'Route: no line matches this API.'
      : `Route: ${n} line${n === 1 ? '' : 's'} ${route.how === 'path' ? 'with a path matching the API' : route.how === 'text' ? 'mentioning the API path' : `mentioning ${flows.classes.endpoint}`}.`);
  }
  $('flow-note').textContent = notes.join(' ');
  $('flow-note').hidden = !notes.length;

  $('panes').innerHTML = '';
  for (const key of FILE_ORDER) {
    if (!files[key]) continue;
    const pane = $('pane-template').content.firstElementChild.cloneNode(true);
    pane.dataset.pane = key;
    $('panes').append(pane);
    view.panes[key] = pane;
  }
  select(0);
}

function select(i) {
  if (!view) return;
  view.selected = i;
  view.whole = {};
  for (const tr of $('flow').querySelectorAll('tbody tr[data-row]')) tr.classList.toggle('sel', Number(tr.dataset.row) === i);
  for (const key of Object.keys(view.panes)) drawPane(key);
}

// Merges [start, end] ranges that overlap or touch.
function mergeRanges(list) {
  const out = [];
  for (const [s, e] of list.sort((a, b) => a[0] - b[0])) {
    const prev = out[out.length - 1];
    if (prev && s <= prev[1] + 1) prev[1] = Math.max(prev[1], e);
    else out.push([s, e]);
  }
  return out;
}

// The line ranges and highlighted lines of a row in one pane.
function rowParts(key, row) {
  if (key === 'route') {
    // The route's matching lines, with two lines of context; the same for every row.
    const marks = view.route ? view.route.lines : [];
    const last = view.files.route.content.split(/\r?\n/).length;
    return { ranges: mergeRanges(marks.map(n => [Math.max(1, n - 2), Math.min(last, n + 2)])), marks };
  }
  if (!row) return { ranges: [], marks: [] };
  const found = (key === 'endpoint' ? [row.endpoint] : row[key]).filter(Boolean);
  const ranges = [];
  for (const [s, e] of found.map(m => [m.startLine, m.endLine]).sort((a, b) => a[0] - b[0])) {
    const prev = ranges[ranges.length - 1];
    if (prev && s <= prev[1] + 1) prev[1] = Math.max(prev[1], e);
    else ranges.push([s, e]);
  }
  const marks = found.map(m => m.declLine).concat(key === 'endpoint' ? row.callLines : []);
  return { ranges, marks };
}

function drawPane(key) {
  const f = view.files[key];
  const pane = view.panes[key];
  const q = cls => pane.querySelector('.' + cls);
  q('pane-label').textContent = f.label;
  q('pane-file').textContent = f.loc ? f.loc.path.split('/').pop() : f.url;
  q('pane-where').textContent = f.loc ? `${f.loc.project}/${f.loc.repo} · ${f.loc.path}` : '';
  q('pane-open').hidden = !f.loc;
  if (f.loc) q('pane-open').href = f.loc.browseUrl;
  const msg = q('pane-msg');

  if (f.error) {
    msg.textContent = f.error;
    msg.className = 'pane-msg note error';
    msg.hidden = false;
    q('pane-code').innerHTML = '';
    q('pane-toggle').hidden = true;
    q('pane-copy').hidden = true;
    return;
  }

  const row = view.flows.rows[view.selected];
  const { ranges, marks } = rowParts(key, row);
  const whole = view.whole[key] || !ranges.length;
  msg.className = 'pane-msg note';
  msg.textContent = ranges.length ? ''
    : key === 'route' ? 'No line in the Route file matches this API: showing the whole file.'
    : row ? `No ${f.label} method for this row: showing the whole file.` : '';
  msg.hidden = !msg.textContent;

  const lines = f.content.split(/\r?\n/);
  const markSet = new Set(marks);
  const line = n => `<span class="ln${markSet.has(n) ? ' match' : ''}" data-n="${n}">${esc(lines[n - 1]) || ' '}</span>`;
  const range = (s, e) => Array.from({ length: e - s + 1 }, (_, i) => line(s + i)).join('');
  q('pane-code').innerHTML = whole ? range(1, lines.length) : ranges.map(([s, e]) => range(s, e)).join('<span class="gap">⋯</span>');
  q('pane-code').scrollTop = 0;
  q('pane-toggle').hidden = !ranges.length;
  q('pane-toggle').textContent = whole ? 'Show found section only' : 'Show whole file';
  q('pane-copy').hidden = false;
  // Scroll the whole file to the first highlighted line.
  if (whole && marks.length) {
    const el = q('pane-code').querySelector(`[data-n="${Math.min(...marks)}"]`);
    if (el) q('pane-code').scrollTop = el.offsetTop - 40;
  }
}

// The text a pane shows: its found sections, or the whole file.
function shownText(key) {
  const f = view.files[key];
  const { ranges } = rowParts(key, view.flows.rows[view.selected]);
  if (view.whole[key] || !ranges.length) return f.content;
  const lines = f.content.split(/\r?\n/);
  return ranges.map(([s, e]) => lines.slice(s - 1, e).join('\n')).join('\n\n');
}

$('flow').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-row]');
  if (tr) select(Number(tr.dataset.row));
});
$('flow').addEventListener('keydown', e => {
  const tr = e.target.closest('tr[data-row]');
  if (!tr) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(Number(tr.dataset.row)); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
    if (next && next.dataset.row) { next.focus(); select(Number(next.dataset.row)); }
  }
});

$('panes').addEventListener('click', async e => {
  const pane = e.target.closest('.pane');
  if (!pane || !view) return;
  const key = pane.dataset.pane;
  if (e.target.closest('.pane-toggle')) {
    const { ranges } = rowParts(key, view.flows.rows[view.selected]);
    view.whole[key] = !(view.whole[key] || !ranges.length);
    drawPane(key);
  } else if (e.target.closest('.pane-copy')) {
    try {
      await navigator.clipboard.writeText(shownText(key));
      setStatus(`${view.files[key].label} copied.`);
    } catch {
      setStatus('Clipboard not available in this browser.', true);
    }
  }
});

// ---- Start-up ----

updateState();
// Fill any empty login fields from .env defaults, if the server has them.
fetch('/api/config').then(r => r.json()).then(c => {
  for (const [k, id] of Object.entries(CONN_FIELDS)) if (!$(id).value && c[k]) $(id).value = c[k];
  updateState();
  refreshAll();
}).catch(() => setConnStatus('Server not reachable. Is StoryZLine running?', true));

const savedList = store.json('pickList');
if (savedList && Array.isArray(savedList.entries) && savedList.entries.length) loadPickList(savedList);
else refreshAll();
