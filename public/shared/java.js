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

// ---- Every method of a file, annotated or not ----

const NOT_A_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new',
  'else', 'throw', 'super', 'this', 'try', 'do', 'case', 'assert', 'yield']);

// Moves a start line up over the annotations and comments directly above a declaration:
// every line up to the previous blank line or the previous statement / block end.
function sectionStart(srcLines, line) {
  while (line > 1) {
    const t = srcLines[line - 2].trim();
    if (!t || /[;{}]$/.test(t) && !/^(\/\/|\/\*|\*)/.test(t)) break;
    line--;
  }
  return line;
}

// Returns [{ name, params, declLine, startLine, endLine, bodyStart, bodyEnd }] for each method
// and constructor declaration (bodyStart/bodyEnd are offsets of its "{" and "}", or of ";").
function findMethods(src) {
  const code = stripComments(src);
  const lineOf = lineIndex(code);
  const srcLines = src.split(/\r?\n/);
  const methods = [];
  const re = /[\w$>\]]\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const name = m[1];
    const nameAt = code.lastIndexOf(name, re.lastIndex - 1);
    const before = code.slice(Math.max(0, m.index - 30), nameAt).match(/([\w$]+)[\s>\]]*$/);
    if (NOT_A_METHOD.has(name) || (before && NOT_A_METHOD.has(before[1]))) continue;
    const open = code.indexOf('(', nameAt);
    let k = skipParens(code, open);
    while (/\s/.test(code[k] || '')) k++;
    if (code.startsWith('throws', k)) while (k < code.length && code[k] !== '{' && code[k] !== ';') k++;
    if (code[k] !== '{' && code[k] !== ';') continue;
    const end = blockEnd(code, k);
    const declLine = lineOf(nameAt);
    methods.push({
      name,
      params: code.slice(open + 1, skipParens(code, open) - 1).replace(/\s+/g, ' ').trim(),
      declLine,
      startLine: sectionStart(srcLines, declLine),
      endLine: lineOf(end),
      bodyStart: k,
      bodyEnd: end,
    });
    re.lastIndex = end + 1;  // skip the body: no method declarations inside it
  }
  return methods;
}

const typeName = src => (stripComments(src).match(/\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/) || [])[1] || null;
const samePath = (a, b) => {
  const norm = p => String(p).replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
};
const section = m => m && { name: m.name || m.methodName, declLine: m.declLine, startLine: m.startLine, endLine: m.endLine };

// Names of fields, parameters and locals in `code` typed as one of `types`.
function typedVars(code, types) {
  return types.filter(Boolean).flatMap(type =>
    [...code.matchAll(new RegExp(`\\b${type}(?:<[^>]*>)?\\s+([A-Za-z_$][\\w$]*)\\s*[;=,)]`, 'g'))].map(x => x[1]));
}

// The calls inside `method` (from findMethods on `code`) worth following: on one of `vars` or,
// when there are none, to a method name accepted by `known`. Returns [{ called, receiver, line }].
function callsIn(code, lineOf, method, vars, known) {
  if (method.bodyStart == null) return [];
  const body = code.slice(method.bodyStart, method.bodyEnd + 1);
  const calls = [];
  // receiver.method( or something().method( (the receiver is then a call result, e.g. new X().run()).
  for (const c of body.matchAll(/(?:([A-Za-z_$][\w$]*)|\))\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    const [, receiver, called] = c;
    if (vars.length ? !vars.includes(receiver) : !known(called)) continue;
    calls.push({ called, receiver: receiver || '…', line: lineOf(method.bodyStart + c.index) });
  }
  return calls;
}

// Adds the methods of `callees` named by `calls` to `list` (once each); returns the raw methods added.
function collect(list, callees, calls) {
  const added = [];
  for (const c of calls) {
    for (const target of callees.filter(x => x.name === c.called)) {
      if (list.some(x => x.declLine === target.declLine)) continue;
      list.push({ ...section(target), call: `${c.receiver}.${c.called}()` });
      added.push(target);
    }
  }
  return added;
}

// Follows an eComm API through its code. Each source is a file's text, or null if not pulled.
//   API path -> Endpoint: the Endpoint methods whose mapping matches apiPath (exact, or the end of
//                         it); with no apiPath, every mapped Endpoint method.
//   Endpoint -> API, Controller: calls inside that Endpoint method on a field, parameter or
//                         variable typed as the API class or the Controller class (or, with no such
//                         variable, calls to any method those files have). Each called method is
//                         looked up by name in the API file and in the Controller file (its
//                         implementation when the Controller implements the API).
//   Controller -> Command: the same, from those Controller methods (or from the Endpoint method
//                         when no Controller file is pulled) into the Command file.
// Returns { rows, classes }. Each row: { methods, paths, match, endpoint, api[], controller[],
// command[], callLines[] (Endpoint lines), commandCallLines[] and commandFrom ('controller' or
// 'endpoint': the file those lines are in) }.
function traceFlows({ endpoint: endpointSrc = null, api: apiSrc = null, controller: controllerSrc = null, command: commandSrc = null, apiPath = '' } = {}) {
  const classes = {
    endpoint: endpointSrc && typeName(endpointSrc),
    api: apiSrc && typeName(apiSrc),
    controller: controllerSrc && typeName(controllerSrc),
    command: commandSrc && typeName(commandSrc),
  };
  if (!endpointSrc) return { rows: [], classes };

  const ownMethods = (src, cls) => (src ? findMethods(src).filter(x => x.name !== cls) : []);
  const callees = {
    api: ownMethods(apiSrc, classes.api),
    controller: ownMethods(controllerSrc, classes.controller),
    command: ownMethods(commandSrc, classes.command),
  };
  const ep = { code: stripComments(endpointSrc) };
  ep.lineOf = lineIndex(ep.code);
  ep.vars = typedVars(ep.code, [classes.api, classes.controller]);
  ep.commandVars = typedVars(ep.code, [classes.command]);
  const ctl = controllerSrc ? { code: stripComments(controllerSrc) } : null;
  if (ctl) {
    ctl.lineOf = lineIndex(ctl.code);
    ctl.commandVars = typedVars(ctl.code, [classes.command]);
  }
  const has = list => name => list.some(x => x.name === name);

  const epEps = findEndpoints(endpointSrc);
  const epMethods = findMethods(endpointSrc);
  const methodOf = e => epMethods.find(x => x.name === e.methodName && x.endLine >= e.declLine && x.startLine <= e.declLine);

  // Starting points: Endpoint mappings matching the API path, or all of them.
  const starts = [];
  if (normaliseApi(apiPath)) {
    for (const m of matchEndpoints(epEps, apiPath)) {
      const same = starts.find(s => s.ep.declLine === m.declLine);
      if (same) { if (!same.paths.includes(m.path)) same.paths.push(m.path); }
      else starts.push({ methods: m.methods, paths: [m.path], match: m.match, ep: m });
    }
  } else {
    for (const e of epEps) starts.push({ methods: e.methods, paths: e.paths, match: null, ep: e });
  }

  const rows = starts.map(s => {
    const endpoint = methodOf(s.ep) || s.ep;
    const row = { methods: s.methods, paths: s.paths, match: s.match, endpoint: section(endpoint), api: [], controller: [], command: [], callLines: [], commandCallLines: [] };

    // Endpoint -> API and Controller.
    const epCalls = callsIn(ep.code, ep.lineOf, endpoint, ep.vars, name => has(callees.api)(name) || has(callees.controller)(name));
    collect(row.api, callees.api, epCalls);
    const ctlTargets = collect(row.controller, callees.controller, epCalls);
    row.callLines = epCalls.map(c => c.line);

    // Controller (or, without one, Endpoint) -> Command.
    if (callees.command.length) {
      const fromController = Boolean(ctl && ctlTargets.length);
      const from = fromController ? { file: ctl, methods: ctlTargets } : { file: ep, methods: [endpoint] };
      row.commandFrom = fromController ? 'controller' : 'endpoint';
      for (const m of from.methods) {
        const calls = callsIn(from.file.code, from.file.lineOf, m, from.file.commandVars, has(callees.command));
        collect(row.command, callees.command, calls);
        row.commandCallLines.push(...calls.map(c => c.line));
      }
    }
    row.callLines = [...new Set(row.callLines)];
    row.commandCallLines = [...new Set(row.commandCallLines)];
    return row;
  });
  return { rows, classes };
}

// Lines of a route/configuration file (any text format, e.g. XML) that belong to an eComm API.
// In order, the first that finds something:
//   'path': lines holding a path pattern that matches the API path: the whole of one of them
//           matching the end of the other, so a context path like /spl-banking may be on either
//           side ({var} and * match one segment, ** any number; at least two fixed segments);
//   'text': lines containing the longest run (at least three segments, or all) of the API path;
//   'name': with no API path, lines mentioning one of `names` (e.g. the Endpoint class).
// Returns { lines, how }.
function findRouteLines(src, apiPath, names = []) {
  const lines = String(src || '').split(/\r?\n/);
  const api = normaliseApi(apiPath);
  const hits = new Set();
  const segment = s => (s === '**' ? '.*' : s === '*' ? '[^/]+'
    : s.replace(/\{[^}]*\}/g, '\u0000').replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\u0000/g, '[^/]+'));
  if (api && api !== '/') {
    lines.forEach((line, i) => {
      for (const t of line.matchAll(/\/[A-Za-z0-9_\-.{}*~$/]+/g)) {
        const segs = t[0].split('/').filter(Boolean);
        const fixed = list => list.filter(s => !/[*{}]/.test(s)).length;
        if (fixed(segs) < 2) continue;
        // The pattern matches the end of the API, or the API matches the end of the pattern.
        let found = new RegExp(`(^|/)${segs.map(segment).join('/')}$`, 'i').test(api);
        for (let k = 1; !found && fixed(segs.slice(k)) >= 2; k++) {
          found = new RegExp(`^/${segs.slice(k).map(segment).join('/')}$`, 'i').test(api);
        }
        if (found) { hits.add(i + 1); break; }
      }
    });
    if (hits.size) return { lines: [...hits], how: 'path' };
    const segs = api.split('/').filter(Boolean);
    for (let n = segs.length; n >= Math.min(3, segs.length) && !hits.size; n--) {
      for (let s = 0; s + n <= segs.length; s++) {
        const needle = segs.slice(s, s + n).join('/').toLowerCase();
        lines.forEach((line, i) => { if (line.toLowerCase().includes(needle)) hits.add(i + 1); });
      }
    }
    return { lines: [...hits].sort((a, b) => a - b), how: hits.size ? 'text' : null };
  }
  for (const name of names.filter(Boolean)) {
    const rx = new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\b`);
    lines.forEach((line, i) => { if (rx.test(line)) hits.add(i + 1); });
  }
  return { lines: [...hits].sort((a, b) => a - b), how: hits.size ? 'name' : null };
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

const api = { analyse, findEndpoints, findMethods, traceFlows, findRouteLines, matchEndpoints, normaliseApi, stripComments };
if (typeof module === 'object' && module.exports) module.exports = api;
else window.StoryZJava = api;
})();
