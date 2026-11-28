// Reads Camel XML routes into their steps, and follows direct:/seda:/vm: calls from route to route.
// Shared by the browser page and the Node tests, so it must not use Node-only APIs.
(function () {
  'use strict';

  // Elements that hold an expression or a setting of their parent, not a step of their own.
  const EXPRESSIONS = new Set([
    'simple', 'constant', 'header', 'exchangeProperty', 'variable', 'xpath', 'jsonpath', 'xquery', 'groovy', 'method',
    'ref', 'el', 'ognl', 'spel', 'mvel', 'tokenize', 'language', 'javaScript', 'js', 'python', 'csimple', 'datasonnet',
    'joor', 'java', 'expression', 'exception', 'handled', 'continued', 'onWhen', 'retryWhile', 'redeliveryPolicy',
    'correlationExpression', 'completionPredicate', 'completionSizeExpression', 'completionTimeoutExpression',
    'description', 'routeProperty', 'inputType', 'outputType',
  ]);
  // Steps that send to another endpoint through their uri attribute.
  const SENDERS = new Set(['to', 'toD', 'wireTap', 'inOnly', 'inOut', 'enrich', 'pollEnrich']);

  const decode = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const local = name => name.replace(/^.*:/, '');

  // A small XML reader: elements with attributes, text and line numbers. Comments are blanked out
  // first (line breaks kept), so line numbers match the file.
  function parseXml(src) {
    const text = String(src || '').replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    const lineOf = offset => {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
      return lo + 1;
    };
    const root = { name: '#root', attrs: {}, line: 1, children: [], text: '' };
    const stack = [root];
    const tag = /<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    let last = 0;
    for (const m of text.matchAll(tag)) {
      const top = stack[stack.length - 1];
      const between = text.slice(last, m.index);
      last = m.index + m[0].length;
      if (between.trim()) top.text += decode(between);
      if (m[1] !== undefined) { top.text += m[1]; continue; }  // CDATA
      if (m[3] === undefined) continue;                         // <?xml ?>, <!DOCTYPE>
      const name = local(m[3]);
      if (m[2]) {
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === name) { stack.length = i; break; }
        continue;
      }
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decode(a[2] !== undefined ? a[2] : a[3]);
      const node = { name, attrs, line: lineOf(m.index), children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    }
    return root;
  }

  // An expression element as text: "simple ${header.x} == 'A'", "constant 400", "handled constant true".
  function expressionText(e) {
    const own = e.text.replace(/\s+/g, ' ').trim();
    const inner = e.children.map(expressionText).filter(Boolean).join(' ');
    if (e.name === 'exception') return own;
    return [e.name, own, inner].filter(Boolean).join(' ');
  }

  function toStep(n) {
    const a = n.attrs;
    const step = { kind: n.name, line: n.line, target: '', detail: '', children: [] };
    const exprs = n.children.filter(c => EXPRESSIONS.has(c.name));
    if (n.name === 'marshal' || n.name === 'unmarshal') {
      const format = n.children[0];
      step.target = a.ref || (format ? format.name + (format.attrs.library ? ` (${format.attrs.library})` : '') : '');
      return step;
    }
    if (n.name === 'bean') {
      step.target = (a.ref || a.beanType || '') + (a.method ? `.${a.method}()` : '');
      step.bean = { bean: a.ref || a.beanType || '', method: a.method || '' };
    } else if (n.name !== 'log') {
      step.target = a.uri || a.ref || a.name || a.type || a.exceptionType || a.method || '';
    }
    step.detail = a.message || '';
    const rest = exprs.map(expressionText).filter(Boolean).join('; ');
    step.detail = [step.detail, rest].filter(Boolean).join('; ');
    step.children = steps(n.children);
    const b = beanCall(step);
    if (b) step.bean = b;
    return step;
  }

  function steps(nodes) {
    return nodes.filter(c => !EXPRESSIONS.has(c.name)).map(toStep);
  }

  // Every <route> in a Camel XML file: { id, line, from, fromLine, steps: [{ kind, line, target, detail, children, bean? }] }.
  function parseRoutes(src) {
    const routes = [];
    const walk = node => {
      for (const c of node.children) {
        if (c.name !== 'route') { walk(c); continue; }
        const from = c.children.find(x => x.name === 'from');
        routes.push({
          id: c.attrs.id || '', line: c.line,
          from: from ? from.attrs.uri || '' : '', fromLine: from ? from.line : c.line,
          steps: steps(c.children.filter(x => x !== from)),
        });
      }
    };
    walk(parseXml(src));
    return routes;
  }

  // The endpoint name of an in-Camel call (direct:, direct-vm:, seda:, vm:), else null.
  function internalName(uri) {
    const m = /^(?:direct|direct-vm|seda|vm):(?:\/\/)?([^?]+)/i.exec(String(uri || '').trim());
    return m ? m[1] : null;
  }

  // The bean and method a step calls: <bean ref method>, or uri bean:name?method=m.
  function beanCall(step) {
    if (step.kind === 'bean') return step.bean;
    if (!SENDERS.has(step.kind)) return null;
    const m = /^bean:([^?]+)(?:\?(?:.*&)?method=([^&]+))?/i.exec(step.target);
    return m ? { bean: m[1], method: m[2] ? decodeURIComponent(m[2]).replace(/\(.*$/, '') : '' } : null;
  }

  // A route's steps with every direct:/seda:/vm: call followed into the route that starts with it.
  // all: [{ route, file }] (routes of every Route file). A followed call gets .follow
  // ({ id, from, file, line, steps }); one with no such route gets .missing; one back into a route
  // already on the way gets .loop; deeper than maxDepth gets .deep.
  // Every step gets .file: the file it is in (startFile for the start route's own steps).
  function followRoutes(start, all, startFile, maxDepth = 8) {
    const index = new Map();
    for (const x of all) {
      const name = internalName(x.route.from);
      if (name && !index.has(name)) index.set(name, x);
    }
    let followed = 0;
    const walk = (list, trail, file) => list.map(s => {
      const out = { ...s, file, children: walk(s.children, trail, file) };
      const name = SENDERS.has(s.kind) ? internalName(s.target) : null;
      if (name) {
        const hit = index.get(name);
        if (!hit) out.missing = name;
        else if (trail.includes(hit.route)) out.loop = { id: hit.route.id, file: hit.file, line: hit.route.line };
        else if (trail.length > maxDepth) out.deep = true;
        else {
          followed++;
          out.follow = { id: hit.route.id, from: hit.route.from, file: hit.file, line: hit.route.line, steps: walk(hit.route.steps, [...trail, hit.route], hit.file) };
        }
      }
      return out;
    });
    const result = walk(start.steps, [start], startFile);
    return { steps: result, followed };
  }

  const api = { parseXml, parseRoutes, followRoutes, internalName, beanCall };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.StoryZCamel = api;
})();
