'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let last = null;

// Remember the last inputs per browser, purely as a convenience.
const store = {
  get(k) { try { return localStorage.getItem('storyzline.' + k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem('storyzline.' + k, v); } catch { /* storage unavailable */ } },
};
$('api').value = store.get('api');
$('location').value = store.get('location');

fetch('/api/config').then(r => r.json()).then(c => {
  const parts = [];
  if (c.baseUrl) parts.push(`Bitbucket: <b>${esc(c.baseUrl)}</b>`);
  else parts.push('<span class="warn">BITBUCKET_BASE_URL not set in .env</span>');
  if (c.project && c.repo) parts.push(`default repo ${esc(c.project)}/${esc(c.repo)}${c.branch ? ' @ ' + esc(c.branch) : ''}`);
  parts.push(c.tokenSet ? `token: ${esc(c.auth)}` : '<span class="warn">no token</span>');
  $('config').innerHTML = parts.join(' · ');
}).catch(() => { $('config').innerHTML = '<span class="warn">Server not reachable</span>'; });

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const ecommApi = $('api').value.trim();
  const location = $('location').value.trim();
  store.set('api', ecommApi);
  store.set('location', location);
  setStatus('Pulling…');
  $('go').disabled = true;
  try {
    const res = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ecommApi, location }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
