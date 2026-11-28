// Lightweight Java endpoint scanner: finds Spring MVC / JAX-RS mappings and matches them
// against an eCommAPI path. It is a heuristic text scan, not a full Java parser.
// Shared by the browser page and the Node tests.
(function () {
'use strict';

const MAPPINGS = {
  RequestMapping: null, GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT',
  DeleteMapping: 'DELETE', PatchMapping: 'PATCH', Path: null,
};
const JAXRS_VERBS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

// Blank out comments but keep newlines and string literals, so offsets and line numbers stay valid.
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '"' || c === "'") {
      const q = c;
      out += c;
      for (i++; i < src.length && src[i] !== q && src[i] !== '\n'; i++) {
        out += src[i];
        if (src[i] === '\\' && i + 1 < src.length) out += src[++i];
      }
      if (i < src.length) out += src[i];
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      if (i < src.length) out += '\n';
    } else if (c === '/' && n === '*') {
      out += '  ';
      for (i += 2; i < src.length && !(src[i] === '*' && src[i + 1] === '/'); i++) out += src[i] === '\n' ? '\n' : ' ';
      out += '  ';
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

// From an opening "(" at index i, return the index just after its matching ")".
function skipParens(s, i) {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === '\\') i++; }
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return s.length;
}

function literals(s) {
  return [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
}

function mappingPaths(args) {
  if (args == null || !args.trim()) return [''];
  const named = args.match(/\b(?:value|path)\s*=\s*(\{[^}]*\}|"(?:[^"\\]|\\.)*"|[\w.]+)/);
  let expr = named ? named[1] : null;
  if (!expr) {
    const t = args.trim();
    if (t.startsWith('"')) expr = t.match(/^"(?:[^"\\]|\\.)*"/)[0];
    else if (t.startsWith('{')) expr = t.slice(0, t.indexOf('}') + 1);
    else if (/^[\w.]+\s*(,|$)/.test(t)) expr = t.match(/^[\w.]+/)[0];
    else return [''];
  }
  const lits = literals(expr);
  if (lits.length) return lits;
  // A constant such as ApiPaths.PORTFOLIO cannot be resolved from this file alone.
  return /^[\w.]+$/.test(expr.trim()) ? [`\${${expr.trim()}}`] : [''];
}

function joinPath(a, b) {
  const p = ('/' + a + '/' + b).replace(/\/+/g, '/');
  return p.length > 1 ? p.replace(/\/$/, '') : p;
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return offset => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

// Group consecutive annotations with the declaration that follows them.
function annotationGroups(code) {
  const groups = [];
  const re = /(?<![\w.@"$])@([A-Za-z_][\w.]*)/g;
  let m, group = null;
  while ((m = re.exec(code))) {
    if (m[1] === 'interface') continue;
    const at = m.index;
    let i = re.lastIndex;
    while (/\s/.test(code[i] || '')) i++;
    let args = null;
    if (code[i] === '(') {
      const end = skipParens(code, i);
      args = code.slice(i + 1, end - 1);
      i = end;
    }
    if (!group) group = { annotations: [], start: at };
    group.annotations.push({ name: m[1].split('.').pop(), args, offset: at });
    while (/\s/.test(code[i] || '')) i++;
    if (code[i] === '@') { re.lastIndex = i; continue; }

    // Read the declaration up to "{" or ";" at paren depth 0.
    let depth = 0, j = i;
    for (; j < code.length; j++) {
      const c = code[j];
      if (c === '"') { for (j++; j < code.length && code[j] !== '"'; j++) if (code[j] === '\\') j++; }
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      else if ((c === '{' || c === ';') && depth <= 0) break;
    }
    group.decl = code.slice(i, j).replace(/\s+/g, ' ').trim();
    group.declOffset = i;
    group.bodyOffset = j;  // the "{" that opens the body, or ";" when there is none
    groups.push(group);
    group = null;
    re.lastIndex = j;
  }
  return groups;
}

// Offset of the "}" that closes the block opened at `open` (string and char literals skipped).
function blockEnd(code, open) {
  if (code[open] !== '{') return open;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'") { for (i++; i < code.length && code[i] !== c && code[i] !== '\n'; i++) if (code[i] === '\\') i++; }
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return code.length - 1;
}

// Moves a start line up over the comment lines (Javadoc, //) directly above it.
function withLeadingComments(srcLines, line) {
  while (line > 1 && /^(\/\/|\/\*|\*)/.test(srcLines[line - 2].trim())) line--;
  return line;
}

function findEndpoints(src) {
  const code = stripComments(src);
  const lineOf = lineIndex(code);
  const srcLines = src.split(/\r?\n/);
  const endpoints = [];
  let classBases = [''];
  let className = null;

  for (const g of annotationGroups(code)) {
    const mapping = g.annotations.find(a => a.name in MAPPINGS);
    const classDecl = g.decl.match(/\b(class|interface|enum|record)\s+(\w+)/);
    if (classDecl) {
      className = classDecl[2];
      classBases = mapping ? mappingPaths(mapping.args) : [''];
      continue;
    }
    const verbs = g.annotations.filter(a => JAXRS_VERBS.has(a.name)).map(a => a.name);
    if (!mapping && !verbs.length) continue;

    const methodName = (g.decl.match(/(\w+)\s*\(/) || [])[1] || null;
    if (mapping) {
      if (MAPPINGS[mapping.name]) verbs.push(MAPPINGS[mapping.name]);
      for (const v of (mapping.args || '').matchAll(/RequestMethod\.(\w+)/g)) verbs.push(v[1]);
    }
    const local = mapping ? mappingPaths(mapping.args) : [''];
    const paths = [];
    for (const b of classBases) for (const p of local) paths.push(joinPath(b, p));

    endpoints.push({
      methods: verbs.length ? [...new Set(verbs)] : ['ANY'],
      paths,
      className,
      methodName,
      line: lineOf((mapping || g.annotations[0]).offset),
      declLine: lineOf(g.declOffset),
      // The method's whole section: comments and annotations above it, down to its closing "}".
      startLine: withLeadingComments(srcLines, lineOf(g.start)),
      endLine: lineOf(blockEnd(code, g.bodyOffset)),
    });
  }
  return endpoints;
}

function normaliseApi(api) {
  let s = String(api || '').trim();
  if (!s) return '';
  try { if (/^https?:\/\//i.test(s)) s = new URL(s).pathname; } catch { /* keep as typed */ }
  s = s.split(/[?#]/)[0].replace(/\/+/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  return s.length > 1 ? s.replace(/\/$/, '') : s;
}

function pathRegex(path) {
  const parts = path.split(/(\{[^}]*\}|\$\{[^}]*\})/).map(seg => {
    if (/^\$?\{/.test(seg)) return '[^/]+';
    return seg.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\*\\\*|\\\*/g, '[^/]*');
  });
  return parts.join('');
}

// exact: the path matches the whole eCommAPI; suffix: it matches the end of it
// (the eCommAPI usually carries a context path such as /spl-banking that the code omits).
function matchEndpoints(endpoints, api) {
  const target = normaliseApi(api);
  if (!target) return [];
  const out = [];
  for (const ep of endpoints) {
    for (const p of ep.paths) {
      if (p === '/') continue;
      const rx = pathRegex(p);
      if (new RegExp(`^${rx}$`, 'i').test(target)) out.push({ ...ep, path: p, match: 'exact' });
      else if (new RegExp(`/${rx.replace(/^\//, '')}$`, 'i').test(target)) out.push({ ...ep, path: p, match: 'suffix' });
    }
  }
  return out.sort((a, b) => (a.match === b.match ? b.path.length - a.path.length : a.match === 'exact' ? -1 : 1));
}

// Lines that mention the eCommAPI text or its last path segment.
function textHits(src, api) {
  const target = normaliseApi(api);
  if (!target || target === '/') return [];
  const needles = [target, target.split('/').filter(Boolean).pop()].filter(n => n && n.length >= 3);
  const lower = needles.map(n => n.toLowerCase());
  const hits = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const l = line.toLowerCase();
    if (lower.some(n => l.includes(n))) hits.push(i + 1);
  });
  return hits;
}

function analyse(src, api) {
  const endpoints = findEndpoints(src);
  return {
    packageName: (src.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || null,
    endpoints,
    matches: matchEndpoints(endpoints, api),
    textHits: textHits(src, api),
    normalisedApi: normaliseApi(api),
  };
}

const api = { analyse, findEndpoints, matchEndpoints, normaliseApi, stripComments };
if (typeof module === 'object' && module.exports) module.exports = api;
else window.StoryZJava = api;
})();
