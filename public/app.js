'use strict';

const $ = id => document.getElementById(id);
const Loc = window.StoryZLocation;
const Java = window.StoryZJava;
const XL = window.StoryZExcel;
const Diagram = window.StoryZDiagram;
const Camel = window.StoryZCamel;
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
  // opts.ownPath (several files): each file row has its own Path instead of one Path for the box.
  constructor(key, legend, files, opts = {}) {
    this.key = key;
    this.el = $('part-template').content.firstElementChild.cloneNode(true);
    this.el.querySelector('legend').textContent = legend;
    // One file: URL, Project, Repository, Path, File, Extension on one line, the joined URL below.
    // Several files: URL, Project, Repository, Path on the first line, then a row per file with
    // its File, Extension and joined URL (and its own Path first, with opts.ownPath).
    const multi = files.length > 1;
    const ownPath = multi && !!opts.ownPath;
    this.el.querySelector('.parts').style.setProperty('--cols',
      'minmax(6rem, 1.4fr) minmax(6rem, .7fr) minmax(8.5rem, 1fr)' + (ownPath ? '' : ' minmax(8rem, 2fr)') +
      (multi ? '' : ' minmax(7rem, 1.3fr) minmax(5.5rem, .7fr)'));
    if (ownPath) this.$('path').closest('label').hidden = true;
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
        row.className = 'file-row' + (ownPath ? ' with-path' : '');
        const urlLabel = document.createElement('label');
        urlLabel.innerHTML = `<span>${esc(f.label)} URL</span>`;
        urlLabel.append(file.url);
        if (ownPath) {
          const pathLabel = document.createElement('label');
          pathLabel.innerHTML = `<span>${esc(f.pathTitle || 'Path')}</span>`;
          file.path = document.createElement('input');
          file.path.className = 'p-file-path';
          file.path.autocomplete = 'off';
          file.path.placeholder = f.pathPlaceholder || 'src/main/…';
          file.path.addEventListener('input', () => this.update());
          pathLabel.append(file.path);
          row.append(pathLabel);
        }
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
      // Its own Path; saved before the boxes had one per file: the box's Path.
      if (f.path) f.path.value = typeof s.path === 'string' ? s.path : saved.path || '';
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
      files: Object.fromEntries(this.files.map(f => [f.key, { fileName: f.name.value, extension: f.ext.value, ...(f.path ? { path: f.path.value } : {}) }])),
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
        path: f.path ? f.path.value : this.$('path').value, fileName: f.name.value, extension: f.ext.value,
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
for (const k of ['endpointParts', 'project', 'repo', 'location', 'branch', 'pickChoice', 'part.api', 'part.controller', 'part.builder', 'part.validator']) store.remove(k);

// The eComm API path picks the Endpoint method(s) to follow.
$('api').value = store.get('api');
$('api').addEventListener('input', () => store.set('api', $('api').value.trim()));

const parts = [
  new Part('endpoint', 'Endpoint', [{ key: 'endpoint', title: 'File', label: 'Endpoint', placeholder: 'CustomerPortfolioEndpoint' }]),
  // Endpoint Route: searched for the Endpoint method's route. Reference Route File: the base routes the
  // routes call (by <from uri> or route id), used to follow and check those references.
  // Each has its own Path: base routes often live in another folder.
  new Part('route', 'Route', [
    { key: 'route', title: 'Endpoint Route', label: 'Route', placeholder: 'portfolio-routes', extension: '.xml', pathPlaceholder: 'src/main/resources/routes' },
    { key: 'routeRef', title: 'Reference Route File', label: 'Reference Route', placeholder: 'base-routes', extension: '.xml', pathPlaceholder: 'src/main/resources/routes/base' },
  ], { ownPath: true }),
  new Part('apictl', 'APIController', [
    { key: 'api', title: 'API File', label: 'API', placeholder: 'CustomerPortfolioApi' },
    { key: 'controller', title: 'Controller File', label: 'Controller', placeholder: 'CustomerPortfolioController' },
  ]),
  new Part('command', 'Command', [{ key: 'command', title: 'File', label: 'Command', placeholder: 'CustomerPortfolioCommand' }]),
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

const FILE_ORDER = ['route', 'endpoint', 'api', 'controller', 'command'];
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
  const pull = async (c, cfg) => {
    let loc;
    try {
      loc = Loc.resolveLocation(c.url, cfg);
      const reply = await post('/api/get', { url: loc.rawUrl, connection: conn });
      const problem = Loc.responseProblem(reply,
        `File not found: ${loc.project}/${loc.repo}/${loc.path}${loc.ref ? ` at ${loc.ref}` : ''}.`);
      if (problem) return { ...c, loc, error: problem, status: reply.status };
      return { ...c, loc, content: reply.body };
    } catch (err) {
      return { ...c, loc, error: err.message };
    }
  };
  // An Endpoint Route with "*" (e.g. payment*.xml): list its folder and pull every file that fits.
  const MAX_MATCHES = 50;
  const expand = async (c, cfg) => {
    let loc;
    try {
      loc = Loc.resolveLocation(c.url, cfg);
    } catch (err) {
      return [{ ...c, error: err.message }];
    }
    const pattern = loc.path.split('/').pop();
    if ((c.key !== 'route' && c.key !== 'routeRef') || !Loc.hasWildcard(pattern)) return [await pull(c, cfg)];
    const folder = loc.path.split('/').slice(0, -1).join('/');
    const where = `${loc.project}/${loc.repo}/${folder}`;
    const names = [];
    try {
      let url = Loc.folderListUrl({ ...loc, folder }, cfg);
      for (let page = 0; url && page < 50; page++) {
        const reply = await post('/api/get', { url, connection: conn });
        const problem = Loc.responseProblem(reply, `Folder not found: ${where}${loc.ref ? ` at ${loc.ref}` : ''}.`);
        if (problem) return [{ ...c, loc, error: problem, status: reply.status }];
        const list = Loc.parseFolderListing(reply.body, url, Loc.isCloud(cfg));
        names.push(...list.files);
        url = list.next;
      }
    } catch (err) {
      return [{ ...c, loc, error: err.message }];
    }
    const rx = Loc.globToRegExp(pattern);
    const hits = names.filter(n => rx.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!hits.length) return [{ ...c, loc, error: `No file in ${where} matches ${pattern}.` }];
    if (hits.length > MAX_MATCHES) return [{ ...c, loc, error: `${hits.length} files in ${where} match ${pattern}; make the pattern narrower (at most ${MAX_MATCHES}).` }];
    const one = { ...cfg, project: loc.project, repo: loc.repo, branch: loc.ref };
    return Promise.all(hits.map(n => pull({ ...c, url: folder ? `${folder}/${n}` : n, pattern }, one)));
  };
  try {
    const results = (await Promise.all(chosen.map(c => expand(c, c.part.cfg(conn))))).flat();
    const apiPath = $('api').value.trim();

    // Second round: the Command classes named by the Controller methods' @CommandHandler, in the
    // Controller's project and repository, folder = Controller folder - last "api" + processing/impl.
    const handlers = {};
    const byKey = Object.fromEntries(results.map(r => [r.key, r]));
    const content = k => (byKey[k] && byKey[k].content != null ? byKey[k].content : null);
    const controller = byKey.controller;
    if (content('endpoint') != null && content('controller') != null && controller.loc) {
      const first = Java.traceFlows({ endpoint: content('endpoint'), api: content('api'), controller: content('controller'), apiPath });
      const names = [...new Set(first.rows.map(r => r.commandHandler && r.commandHandler.command).filter(Boolean))];
      if (names.length) setStatus(`Pulling ${names.join(', ')} named by @CommandHandler…`);
      const path = Loc.commandPathFrom(controller.loc.path);
      await Promise.all(names.map(async name => {
        const where = { baseUrl: conn.baseUrl, project: controller.loc.project, repo: controller.loc.repo, path, fileName: name, extension: '.java' };
        const url = Loc.buildFileUrl(where);
        const same = results.find(r => r.key === 'command' && r.loc && r.loc.path === `${path}/${name}.java` && r.loc.repo === where.repo);
        handlers[name] = same || await pull({ key: 'command', label: 'Command', url }, { ...conn, project: where.project, repo: where.repo });
      }));
      // Show where the (first) Command came from in the Command box.
      if (names.length) {
        const box = parts.find(p => p.key === 'command');
        box.$('project').value = controller.loc.project;
        box.$('repo').value = controller.loc.repo;
        box.$('path').value = path;
        box.files[0].name.value = names[0];
        box.files[0].ext.value = '.java';
        box.files[0].extSelect.value = '.java';
        box.files[0].ext.hidden = true;
        box.refresh();
      }
    }

    const all = [...results, ...Object.values(handlers).filter(h => !results.includes(h))];
    const ok = all.filter(r => r.content != null);
    if (ok.length) loggedIn = true;
    if (all.some(r => r.status === 401)) loggedIn = false;
    updateState();
    render(results, apiPath, handlers);
    const failed = all.filter(r => r.error);
    setStatus(failed.length
      ? `Pulled ${ok.length} of ${all.length} files. ${failed.map(r => `${r.label}: ${r.error}`).join(' ')}`
      : `Pulled ${ok.length} file${ok.length === 1 ? '' : 's'}.`, failed.length > 0);
  } finally {
    $('go').disabled = false;
  }
});

function render(results, apiPath, handlers = {}) {
  // Several Route files when the Endpoint Route has "*": each is searched, and shown in its own tab.
  // The Reference Route files come after them, in tabs of the same pane (marked "ref"): they are
  // not searched for the Endpoint method, only used to follow and check route references.
  const isRoute = r => r.key === 'route' || r.key === 'routeRef';
  const routeFiles = [...results.filter(r => r.key === 'route'), ...results.filter(r => r.key === 'routeRef')];
  const mainFiles = routeFiles.filter(r => r.key === 'route');
  const files = Object.fromEntries(results.filter(r => !isRoute(r)).map(r => [r.key, r]));
  if (routeFiles.length) files.route = mainFiles.find(f => f.content != null) || routeFiles.find(f => f.content != null) || routeFiles[0];
  const src = k => (files[k] && files[k].content != null ? files[k].content : null);
  const flows = Java.traceFlows({
    endpoint: src('endpoint'), api: src('api'), controller: src('controller'), command: src('command'), apiPath,
  });
  // A Controller method's @CommandHandler(command = "X") names the row's Command class, pulled as
  // X.java: it replaces the calls found into the Command box's file.
  for (const r of flows.rows) {
    const h = r.commandHandler;
    const file = h && handlers[h.command];
    if (!file) continue;
    const classLine = file.content != null
      ? file.content.split(/\r?\n/).findIndex(l => new RegExp(`\\b(class|interface|record|enum)\\s+${h.command}\\b`).test(l)) + 1 || 1
      : 1;
    r.commandAuto = { ...file, handler: h, classLine };
    r.command = [];
    r.edges = r.edges.filter(e => e.to.layer !== 'command');
    r.edges.push({
      from: { layer: 'controller', name: h.method, declLine: h.declLine },
      to: { layer: 'command', name: h.command, declLine: `class-${h.command}`, label: h.command, refLine: classLine },
      kind: 'call',
      call: `@CommandHandler(command = "${h.command}"${h.validator ? `, validator = "${h.validator}"` : ''})`,
    });
  }
  // Each row's route: the <route> whose <from uri="…_name"/> names its Endpoint method.
  // In every Route file; each route found remembers its file (its index in routeFiles).
  const multi = routeFiles.length > 1;
  const allOk = routeFiles.map((f, i) => ({ f, i })).filter(x => x.f.content != null);
  const routeOk = allOk.filter(x => x.f.key === 'route');
  let byName = false;
  if (routeOk.length) {
    for (const r of flows.rows) r.routes = [];
    for (const { f, i } of routeOk) {
      const sections = Java.findRouteSections(f.content, flows.rows.map(r => r.endpoint.name));
      for (const r of flows.rows) r.routes.push(...(sections[r.endpoint.name] || []).map(x => ({ ...x, file: multi ? i : undefined })));
    }
    byName = flows.rows.some(r => r.routes.length);
  }
  // Without any such route: the lines with a path matching the API (the same for every row), per file.
  const routeHits = {};
  if (routeOk.length && !byName) {
    for (const { f, i } of routeOk) routeHits[i] = Java.findRouteLines(f.content, apiPath, [flows.classes.endpoint]);
  }
  // For the process diagram, each matching route line comes with the lines after it (up to the
  // next match), which may name the Endpoint method it routes to.
  const routeLines = [];
  for (const { f, i } of routeOk.filter(x => routeHits[x.i])) {
    const lines = f.content.split(/\r?\n/);
    const hit = routeHits[i].lines;
    routeLines.push(...hit.map((n, k) => ({ n, file: multi ? i : undefined, text: lines.slice(n - 1, Math.min(n + 3, hit[k + 1] ? hit[k + 1] - 1 : n + 3)).join('\n') })));
  }
  const route = routeOk.length && !byName ? routeHits[routeOk[0].i] : null;  // for the notes
  const graph = Diagram.flowGraph({ rows: flows.rows, apiPath, routeLines });
  view = { files, routeFiles, routeHits, routeTab: 0, flows, byName, graph, apiPath, selected: 0, panes: {}, whole: {} };
  // For the Route flow: every <route> of every Route file, and the methods a bean step can lead to.
  view.camel = allOk.flatMap(({ f, i }) => Camel.parseRoutes(f.content).map(route => ({ route, file: i, ref: f.key === 'routeRef' })));
  view.linkable = [['controller', 'Controller'], ['api', 'API']].flatMap(([key, label]) =>
    (src(key) != null ? Java.findMethods(src(key)).map(m => ({ key, label, name: m.name, declLine: m.declLine })) : []));
  $('result').hidden = false;

  const none = '<span class="none">—</span>';
  const notPulled = '<span class="none">not pulled</span>';
  const names = list => list.map(m => `${esc(m.name)}()`).join(', ') || none;
  // How an API/Controller method was found: by the Endpoint method's name, or by following its calls.
  const by = (r, k) => (r.linkedBy && r.linkedBy[k] === 'name' ? ' <small>(same name)</small>' : '');
  const match = r => (r.match ? `<span class="pill ${r.match}">${r.match === 'exact' ? 'Exact match' : 'Matches end of API'}</span>` : none);
  // The Command: the class named by @CommandHandler (with its validator), else the calls found.
  const commandCell = r => {
    if (r.commandAuto) {
      const h = r.commandAuto.handler;
      const v = h.validator ? `; validator <code>${esc(h.validator)}</code>` : '';
      return `<code>${esc(h.command)}</code>${r.commandAuto.error ? ' <span class="none">(not found)</span>' : ''} <small>(@CommandHandler${v})</small>`;
    }
    return src('command') != null ? names(r.command) : notPulled;
  };
  // A route id, with its file when there are several Route files.
  const fileName = f => (f.loc ? f.loc.path.split('/').pop() : f.url);
  const routeCell = x => `<code>${esc(x.id || `line ${x.start}`)}</code>${x.file != null ? `<br><small>${esc(fileName(routeFiles[x.file]))}</small>` : ''}`;
  $('flow').querySelector('tbody').innerHTML = flows.rows.map((r, i) => `
    <tr data-row="${i}" tabindex="0">
      <td>${esc(r.methods.join(', ')) || none}</td>
      <td>${r.paths.map(p => `<code>${esc(p)}</code>`).join('<br>') || none}</td>
      <td>${match(r)}</td>
      <td>${r.endpoint ? `${esc(r.endpoint.name)}()` : none}</td>
      <td>${src('route') != null ? (r.routes && r.routes.length ? r.routes.map(routeCell).join('<br>') : none) : notPulled}</td>
      <td>${src('api') != null ? names(r.api) + by(r, 'api') : notPulled}</td>
      <td>${src('controller') != null ? names(r.controller) + by(r, 'controller') : notPulled}</td>
      <td>${commandCell(r)}</td>
    </tr>`).join('') ||
    `<tr><td colspan="8" class="none">${src('endpoint') == null ? 'The Endpoint file was not pulled.' : apiPath ? 'No Endpoint mapping matches this API.' : 'No mappings found in the Endpoint.'}</td></tr>`;

  const linked = flows.rows.filter(r => r.api.length || r.controller.length || r.command.length || r.commandAuto).length;
  $('flow-state').textContent = flows.rows.length ? `${flows.rows.length} row${flows.rows.length === 1 ? '' : 's'}, ${linked} linked past the Endpoint` : '';
  $('flow-state').className = 'state' + (linked ? ' ok' : '');
  const notes = [];
  if (!apiPath && src('endpoint') != null) notes.push('No API given: listing every mapping in the Endpoint.');
  if (apiPath && src('endpoint') != null && !flows.rows.length) notes.push('Showing the whole Endpoint file.');
  const called = [flows.classes.api, flows.classes.controller].filter(Boolean);
  if (called.length && flows.rows.length && !flows.rows.some(r => r.api.length || r.controller.length)) {
    notes.push(`No calls to ${called.join(' or ')} were found in the Endpoint methods.`);
  }
  if (flows.classes.command && flows.rows.length && !flows.rows.some(r => r.command.length || r.commandAuto)) {
    notes.push(`No calls to ${flows.classes.command} were found in the ${src('controller') != null ? 'Controller' : 'Endpoint'} methods.`);
  }
  const inFiles = mainFiles.length > 1 ? ` in ${routeOk.length} Route files matching ${mainFiles[0].pattern}` : '';
  if (byName) {
    const missing = flows.rows.filter(r => !r.routes.length).map(r => `_${r.endpoint.name}`);
    notes.push(`Route: found by the Endpoint method name in <from uri="…_name"/>${inFiles}.${missing.length ? ` No route for ${missing.join(', ')}.` : ''}`);
  } else if (route) {
    const n = Object.values(routeHits).reduce((sum, h) => sum + h.lines.length, 0);
    notes.push(!n ? `Route: no <from uri> ends in ${flows.rows.map(r => `_${r.endpoint.name}`).join(' or ') || 'an Endpoint method name'}, and no line matches this API.`
      : `Route: ${n} line${n === 1 ? '' : 's'} ${route.how === 'path' ? 'with a path matching the API' : route.how === 'text' ? 'mentioning the API path' : `mentioning ${flows.classes.endpoint}`}${inFiles}.`);
  }
  $('flow-note').textContent = notes.join(' ');
  $('flow-note').hidden = !notes.length;

  $('panes').innerHTML = '';
  for (const key of FILE_ORDER) {
    if (!files[key] && !(key === 'command' && flows.rows.some(r => r.commandAuto))) continue;
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
  view.routeForce = null;
  // The Route tab: the first file with a route for this row (else the first file with matching lines).
  if (view.routeFiles.length > 1) {
    const counts = view.routeFiles.map((f, k) => routeCount(k));
    const first = counts.findIndex(n => n > 0);
    view.routeTab = first >= 0 ? first : Math.max(0, view.routeFiles.findIndex(f => f.content != null));
  }
  for (const tr of $('flow').querySelectorAll('tbody tr[data-row]')) tr.classList.toggle('sel', Number(tr.dataset.row) === i);
  for (const key of Object.keys(view.panes)) drawPane(key);
  drawDiagram();
  drawRouteFlow();
}

// The Route flow of the selected row: each of its routes step by step, with direct:/seda:/vm: calls
// followed into the routes they start (in any pulled Route file), and bean calls linked to methods.
function drawRouteFlow() {
  const row = view.flows.rows[view.selected];
  const starts = view.byName && row ? row.routes : [];
  const found = starts.map(x => view.camel.find(c => c.file === (x.file != null ? x.file : 0) && c.route.line === x.start)).filter(Boolean);
  $('route-flow-card').hidden = !found.length;
  if (!found.length) return;
  const multi = view.routeFiles.length > 1;
  const fileName = k => { const f = view.routeFiles[k]; return f.loc ? f.loc.path.split('/').pop() : f.url; };
  const at = (file, line) => `<a href="#" class="rf-line" data-file="${file}" data-line="${line}" title="Show in the Route pane">${multi ? `${esc(fileName(file))}:` : 'line '}${line}</a>`;
  const link = b => {
    const m = b && b.method && view.linkable.find(x => x.name === b.method);
    return m ? ` <a href="#" class="rf-link" data-pane="${m.key}" data-line="${m.declLine}">→ ${m.label} ${esc(m.name)}()</a>` : '';
  };
  let steps = 0, followed = 0, missing = 0;
  // Reference check: every route reference (direct:/seda:/vm: call) once, with where it was found.
  const refs = new Map();
  const check = (s, hit) => {
    const uri = s.target.split('?')[0];
    if (!refs.has(uri) || (refs.get(uri).missing && hit)) refs.set(uri, { uri, from: s, hit, missing: !hit });
  };
  const how = h => [h.ref ? 'Reference Route' : '', h.by === 'id' ? 'by route id' : ''].filter(Boolean).join(', ');
  const stepHtml = s => {
    steps++;
    let html = `<li><span class="rf-kind">${esc(s.kind)}</span>${s.target ? ` <code>${esc(s.target)}</code>` : ''}` +
      `${s.detail ? ` <span class="rf-detail">${esc(s.detail)}</span>` : ''} ${at(s.file, s.line)}${link(s.bean)}`;
    if (s.missing) {
      missing++;
      check(s, null);
      html += ` <span class="rf-note bad">not found in the Route or Reference Route files</span>`;
    }
    if (s.loop) { check(s, s.loop); html += ` <span class="rf-note">back to route ${esc(s.loop.id)}, shown above</span>`; }
    if (s.deep) html += ' <span class="rf-note">not followed further</span>';
    if (s.children.length) html += `<ol>${s.children.map(stepHtml).join('')}</ol>`;
    if (s.follow) {
      followed++;
      check(s, s.follow);
      const tag = how(s.follow);
      html += `<div class="rf-sub${s.follow.ref ? ' rf-ref' : ''}"><div class="rf-head">↳ route <code>${esc(s.follow.id || s.follow.from)}</code> ${at(s.follow.file, s.follow.line)}` +
        `${tag ? ` <span class="rf-tag">${esc(tag)}</span>` : ''}</div><ol>${s.follow.steps.map(stepHtml).join('')}</ol></div>`;
    }
    return html + '</li>';
  };
  $('route-flow').innerHTML = found.map(({ route, file }) => {
    const flow = Camel.followRoutes(route, view.camel, file);
    return `<div class="rf-route"><div class="rf-head">route <code>${esc(route.id || route.from)}</code> ${at(file, route.line)}</div>` +
      `<ol><li><span class="rf-kind">from</span> <code>${esc(route.from)}</code> ${at(file, route.fromLine)}</li>${flow.steps.map(stepHtml).join('')}</ol></div>`;
  }).join('') + referenceCheck([...refs.values()], at, how) +
    (missing ? `<p class="note">Only routes in the pulled files are followed. ${view.routeFiles.some(f => f.key === 'routeRef')
      ? 'Add more base route files with a pattern in Reference Route File (e.g. <code>base*</code>).'
      : 'Put the base routes file in Reference Route File, or widen the Endpoint Route pattern (e.g. <code>*</code>).'}</p>` : '');
  const bad = [...refs.values()].filter(r => r.missing).length;
  $('route-flow-state').textContent = `${steps} step${steps === 1 ? '' : 's'}${followed ? `, ${followed} route${followed === 1 ? '' : 's'} followed` : ''}` +
    (refs.size ? `, ${refs.size - bad} of ${refs.size} reference${refs.size === 1 ? '' : 's'} found` : '');
  $('route-flow-state').className = 'state' + (refs.size && !bad ? ' ok' : '');
}

// The reference check under the Route flow: each route reference, and the route it leads to (or not).
function referenceCheck(refs, at, how) {
  if (!refs.length) return '';
  const rows = refs.map(r => {
    const h = r.hit;
    const where = h ? `route <code>${esc(h.id || '')}</code> ${at(h.file, h.line)}${how(h) ? ` <span class="rf-tag">${esc(how(h))}</span>` : ''}` : '<span class="rf-note bad">not found</span>';
    return `<tr class="${h ? 'ok' : 'bad'}"><td>${h ? '✓' : '✗'}</td><td><code>${esc(r.uri)}</code></td><td>${at(r.from.file, r.from.line)}</td><td>${where}</td></tr>`;
  });
  return `<div class="rf-check"><div class="rf-head">Reference check</div><div class="table-wrap"><table>` +
    `<thead><tr><th></th><th>Reference</th><th>Called at</th><th>Found</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></div>`;
}

// Shows a line in a code pane (the whole file if the line is outside the found sections) and flashes it.
function jumpTo(key, line, file) {
  const pane = view.panes[key];
  if (!pane) return;
  if (key === 'route' && file != null && view.routeFiles.length > 1) {
    view.routeTab = file;
    view.routeForce = file;  // shown even when "Hide files without a route" would hide it
  }
  view.whole[key] = false;
  const { ranges } = rowParts(key, view.flows.rows[view.selected]);
  if (ranges.length && !ranges.some(([s, e]) => s <= line && line <= e)) view.whole[key] = true;
  drawPane(key);
  pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const el = pane.querySelector(`.ln[data-n="${line}"]`);
  if (el) {
    pane.querySelector('.pane-code').scrollTop = el.offsetTop - 40;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  }
}
$('route-flow').addEventListener('click', e => {
  const a = e.target.closest('a[data-line]');
  if (!a || !view) return;
  e.preventDefault();
  if (a.classList.contains('rf-link')) jumpTo(a.dataset.pane, Number(a.dataset.line));
  else jumpTo('route', Number(a.dataset.line), Number(a.dataset.file));
});

// The process diagram, with the selected row's path highlighted.
function drawDiagram() {
  const { graph, flows, files } = view;
  if (!graph.nodes.length) {
    $('diagram').innerHTML = `<p class="diagram-empty">Nothing to draw: ${files.endpoint && files.endpoint.content != null
      ? (view.apiPath ? 'no Endpoint mapping matches this API.' : 'no mappings found in the Endpoint.') : 'the Endpoint file was not pulled.'}</p>`;
    $('diagram-state').textContent = '';
    return;
  }
  const mains = view.routeFiles.filter(f => f.key === 'route');
  const routeFile = mains.length > 1 ? `${mains[0].pattern} (${mains.length} files)`
    : files.route && files.route.loc ? files.route.loc.path.split('/').pop() : '';
  const lanes = {
    route: routeFile, endpoint: flows.classes.endpoint, api: flows.classes.api, controller: flows.classes.controller,
    // The Command classes named by @CommandHandler, else the Command box's class.
    command: [...new Set(flows.rows.filter(r => r.commandAuto).map(r => r.commandAuto.handler.command))].join(', ') || flows.classes.command,
  };
  $('diagram').innerHTML = Diagram.toSvg(graph, { lanes, selected: flows.rows.length > 1 ? view.selected : null });
  const row = flows.rows[view.selected];
  $('diagram-state').textContent = flows.rows.length > 1 && row
    ? `highlighted: ${row.methods.join(' ')} ${row.endpoint.name}() (select another row in Flow, or click a box)`
    : '';
}

// Clicking a box selects its row (unless it is already on the selected path) and shows its code.
function openNode(node) {
  const rows = node.dataset.rows.split(',').map(Number);
  if (!rows.includes(view.selected)) select(rows[0]);
  // A route box from one of several Route files opens that file's tab.
  jumpTo(node.dataset.pane, Number(node.dataset.line), node.dataset.file != null ? Number(node.dataset.file) : undefined);
}
$('diagram').addEventListener('click', e => {
  const node = e.target.closest('.dg-node[data-pane]');
  if (node && view) openNode(node);
});
$('diagram').addEventListener('keydown', e => {
  const node = e.target.closest('.dg-node[data-pane]');
  if (node && view && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openNode(node); }
});

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
    // The row's own <route> section(s) in the file of the Route tab, marking the <route id> and <from uri> lines.
    if (view.byName) {
      const routes = routesInTab(row, view.routeTab);
      return { ranges: mergeRanges(routes.map(x => [x.start, x.end])), marks: routes.flatMap(x => [x.start, x.fromLine]) };
    }
    // Else the lines with a path matching the API, with two lines of context; the same for every row.
    const hits = view.routeHits[view.routeTab];
    const marks = hits ? hits.lines : [];
    const last = paneFile('route').content.split(/\r?\n/).length;
    return { ranges: mergeRanges(marks.map(n => [Math.max(1, n - 2), Math.min(last, n + 2)])), marks };
  }
  if (!row) return { ranges: [], marks: [] };
  // A Command named by @CommandHandler: the whole class, its declaration marked.
  if (key === 'command' && row.commandAuto) return { ranges: [], marks: [row.commandAuto.classLine] };
  const found = (key === 'endpoint' ? [row.endpoint] : row[key]).filter(Boolean);
  const ranges = [];
  for (const [s, e] of found.map(m => [m.startLine, m.endLine]).sort((a, b) => a[0] - b[0])) {
    const prev = ranges[ranges.length - 1];
    if (prev && s <= prev[1] + 1) prev[1] = Math.max(prev[1], e);
    else ranges.push([s, e]);
  }
  // Also mark the call lines: the Endpoint's calls onward, and the Command calls where they are.
  const marks = found.map(m => m.declLine)
    .concat(key === 'endpoint' ? row.callLines : [])
    .concat(key === row.commandFrom ? row.commandCallLines : [])
    .concat(key === 'controller' && row.commandAuto ? [row.commandAuto.handler.line] : []);
  return { ranges, marks };
}

// The file a pane shows for the selected row: the Command named by its @CommandHandler, if any.
function paneFile(key) {
  const row = view.flows.rows[view.selected];
  if (key === 'command' && row && row.commandAuto) return row.commandAuto;
  if (key === 'route' && view.routeFiles.length > 1) return view.routeFiles[view.routeTab];
  return view.files[key];
}

// A row's routes in Route file number `tab` (all of them with a single Route file).
function routesInTab(row, tab) {
  const routes = row && row.routes ? row.routes : [];
  return view.routeFiles.length > 1 ? routes.filter(x => x.file === tab) : routes;
}

// What the selected row found in Route file number `tab`: its routes, else its matching lines.
function routeCount(tab) {
  if (view.byName) return routesInTab(view.flows.rows[view.selected], tab).length;
  return view.routeHits[tab] ? view.routeHits[tab].lines.length : 0;
}

// The Route pane's tabs, one per Route file, with what the selected row found in each.
function drawRouteTabs(pane) {
  let bar = pane.querySelector('.pane-tabs');
  if (view.routeFiles.length < 2) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'pane-tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Route files');
    pane.querySelector('.pane-head').after(bar);
  }
  // "Hide files without a route": leaves out the files where the selected row found nothing
  // (files that failed to pull stay, so their error is seen). Remembered in this browser.
  const counts = view.routeFiles.map((f, k) => (f.content != null ? routeCount(k) : 0));
  const any = counts.some(n => n > 0);
  const hide = store.get('routeHideEmpty') !== 'no';
  const isRef = k => view.routeFiles[k].key === 'routeRef';  // Reference Route files always keep their tab
  const shown = k => !hide || !any || counts[k] > 0 || isRef(k) || view.routeFiles[k].error || k === view.routeForce;
  if (!shown(view.routeTab)) view.routeTab = counts.findIndex(n => n > 0);
  const hidden = view.routeFiles.filter((f, k) => !shown(k)).length;
  bar.innerHTML = view.routeFiles.map((f, k) => {
    if (!shown(k)) return '';
    const n = counts[k];
    const badge = f.error ? '<span class="tab-count bad">!</span>'
      : isRef(k) ? '<span class="tab-count ref" title="Reference Route file">ref</span>'
      : `<span class="tab-count${n ? '' : ' zero'}">${n}</span>`;
    return `<button type="button" class="pane-tab${n || isRef(k) ? '' : ' empty'}" role="tab" data-file="${k}" aria-selected="${k === view.routeTab}"` +
      ` title="${esc(f.loc ? f.loc.path : f.url)}">${esc(f.loc ? f.loc.path.split('/').pop() : f.url)} ${badge}</button>`;
  }).join('') +
    `<label class="tab-filter" title="Hide the Route files where this row has no route"><input type="checkbox" class="route-hide"${hide ? ' checked' : ''}>` +
    ` Hide files without a route${hidden ? ` (${hidden} hidden)` : !any ? ' (none has one)' : ''}</label>`;
}

function drawPane(key) {
  const f = paneFile(key);
  const pane = view.panes[key];
  const q = cls => pane.querySelector('.' + cls);
  if (!f) {
    // Only @CommandHandler Commands were pulled, and this row has none.
    q('pane-label').textContent = 'Command';
    q('pane-file').textContent = '—';
    q('pane-where').textContent = '';
    q('pane-open').hidden = true;
    q('pane-msg').textContent = 'The Controller method of this row has no @CommandHandler.';
    q('pane-msg').className = 'pane-msg note';
    q('pane-msg').hidden = false;
    q('pane-code').innerHTML = '';
    q('pane-toggle').hidden = true;
    q('pane-copy').hidden = true;
    return;
  }
  if (key === 'route') drawRouteTabs(pane);
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
  msg.textContent = key === 'command' && row && row.commandAuto
    ? `From @CommandHandler on ${row.commandAuto.handler.method}() in the Controller${row.commandAuto.handler.validator ? ` (validator ${row.commandAuto.handler.validator})` : ''}: the whole class.`
    : key === 'route' && f.key === 'routeRef' ? 'Reference Route file: the base routes that the routes call. Its routes are not matched to the Endpoint; see the reference check in Route flow.'
    : ranges.length ? ''
    : key === 'route' ? (view.byName && row
      ? `No <route>${view.routeFiles.length > 1 ? ' in this file' : ''} has a <from uri> ending in _${row.endpoint.name}: showing the whole file.`
      : `No line in ${view.routeFiles.length > 1 ? 'this' : 'the'} Route file matches this API: showing the whole file.`)
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
  const f = paneFile(key);
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
  const tab = e.target.closest('.pane-tab');
  if (e.target.closest('.route-hide')) {
    store.set('routeHideEmpty', e.target.checked ? 'yes' : 'no');
    drawPane('route');
  } else if (tab) {
    view.routeTab = Number(tab.dataset.file);
    view.whole.route = false;
    drawPane('route');
  } else if (e.target.closest('.pane-toggle')) {
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
