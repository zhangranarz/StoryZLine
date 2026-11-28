// Turns traced flows into one process diagram: a lane per layer (Request, Endpoint, Route, API,
// Controller, Command, Validator, Builder), a box per method, and an arrow per call. Pure functions that
// return data and SVG text, shared by the browser page and the Node tests.
(function () {
  'use strict';

  const LAYERS = [
    ['start', 'Request'], ['endpoint', 'Endpoint'], ['route', 'Route'], ['api', 'API'],
    ['controller', 'Controller'], ['command', 'Command'], ['validator', 'Validator'], ['builder', 'Builder'],
  ];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const word = name => new RegExp(`\\b${String(name).replace(/[$]/g, '\\$&')}\\b`);

  // A short name for a route entry: its id, else its path, else the start of its first line.
  function routeLabel(text) {
    const first = String(text).split(/\r?\n/)[0];
    const m = first.match(/\bid\s*=\s*"([^"]+)"/i) || first.match(/\bpath\s*=\s*"([^"]+)"/i);
    const label = m ? m[1] : first.trim().replace(/^<|\/?>$/g, '');
    return label.length > 40 ? label.slice(0, 39) + '…' : label;
  }

  // Whether a route entry leads to a row's Endpoint method: by the method's name when the route
  // names Endpoint methods at all, else by HTTP method when it has one, else yes.
  function routeFits(text, row, rows) {
    if (rows.some(r => word(r.endpoint.name).test(text))) return word(row.endpoint.name).test(text);
    const m = String(text).match(/\bmethods?\s*=\s*"([^"]+)"/i);
    if (m && !row.methods.includes('ANY')) {
      const listed = m[1].toUpperCase().split(/[\s,|]+/);
      return row.methods.some(v => listed.includes(v));
    }
    return true;
  }

  // rows: traceFlows rows; routeLines: [{ n, text }] (a matching route line and the lines after it), used for rows without
  // routes of their own (row.routes: [{ id, start, uri }] from findRouteSections).
  // Returns { nodes, edges }; every node and edge knows the rows it belongs to.
  function flowGraph({ rows, apiPath = '', routeLines = [] }) {
    const nodes = new Map();
    const edges = new Map();
    const addNode = (id, layer, label, sub, row, ref) => {
      let n = nodes.get(id);
      if (!n) nodes.set(id, (n = { id, layer, label, sub, rows: [], ref, order: nodes.size }));
      if (!n.rows.includes(row)) n.rows.push(row);
      return n;
    };
    const addEdge = (from, to, kind, label, row) => {
      const id = `${from}>${to}`;
      let e = edges.get(id);
      if (!e) edges.set(id, (e = { id, from, to, kind, label, rows: [] }));
      if (!e.rows.includes(row)) e.rows.push(row);
    };
    const verbs = [...new Set(rows.flatMap(r => r.methods))].filter(v => v !== 'ANY').join(' ');

    rows.forEach((r, i) => {
      addNode('start', 'start', apiPath || 'All Endpoint mappings', verbs, i);
      const ep = `endpoint:${r.endpoint.declLine}`;
      addNode(ep, 'endpoint', `${r.endpoint.name}()`, `${r.methods.join(' ')} ${r.paths.join(' ')}`.trim(), i,
        { pane: 'endpoint', line: r.endpoint.declLine });

      // Request -> Endpoint -> the row's own <route> (found by the Endpoint method name), else the
      // route lines that fit it.
      addEdge('start', ep, 'route', 'mapped to the Endpoint', i);
      const routeIds = [];
      for (const x of r.routes || []) {
        const id = `route:${x.start}`;
        addNode(id, 'route', x.id || `line ${x.start}`, x.uri, i, { pane: 'route', line: x.start });
        addEdge(ep, id, 'route', `route from ${x.uri}`, i);
        routeIds.push(id);
      }
      if (!routeIds.length) {
        for (const l of routeLines.filter(l => routeFits(l.text, r, rows))) {
          const id = `route:${l.n}`;
          addNode(id, 'route', routeLabel(l.text), `line ${l.n}`, i, { pane: 'route', line: l.n });
          addEdge(ep, id, 'route', 'route for the Endpoint', i);
          routeIds.push(id);
        }
      }
      // With a route, the Endpoint's onward calls are drawn from the route's box, so the request
      // reads as one chain (Endpoint -> Route -> API ...) and no arrow crosses the Route lane.
      const via = routeIds[0];

      // Endpoint -> Controller calls made through the API interface are drawn as Endpoint -> API -> Controller.
      const implemented = new Set(r.edges.filter(e => e.kind === 'implements').map(e => e.to.declLine));
      for (const e of r.edges) {
        if (e.from.layer === 'endpoint' && e.to.layer === 'controller' && implemented.has(e.to.declLine)) continue;
        let from = `${e.from.layer}:${e.from.declLine}`;
        const to = `${e.to.layer}:${e.to.declLine}`;
        addNode(from, e.from.layer, `${e.from.name}()`, '', i, { pane: e.from.layer, line: e.from.declLine });
        addNode(to, e.to.layer, `${e.to.name}()`, '', i, { pane: e.to.layer, line: e.to.declLine });
        let label = e.call;
        if (via && e.from.layer === 'endpoint' && e.to.layer !== 'builder') {
          from = via;
          label = `in ${e.from.name}(): ${e.call}`;  // the call is in the Endpoint method
        }
        addEdge(from, to, e.to.layer === 'builder' ? 'response' : e.kind, label, i);
      }
    });
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  // Lays the graph out in lanes and returns SVG text.
  // lanes: { layer: subtitle } (e.g. class names); selected: the highlighted row, or null for all.
  function toSvg(graph, { lanes = {}, selected = null } = {}) {
    const order = LAYERS.map(l => l[0]).filter(k => graph.nodes.some(n => n.layer === k));
    const CHAR = 7, NODE_H = 46, LANE_H = 88, LABEL_W = 170, GAP = 26, PAD = 18, MIN_W = 540, MAX_LABEL = 52;
    const width = n => Math.max(132, Math.min(380, Math.max(Math.min(n.label.length, MAX_LABEL), n.sub.length * 0.82) * CHAR + 28));
    const on = item => selected == null || item.rows.includes(selected);

    // Place nodes: lanes top to bottom, boxes centred in each lane in first-seen order.
    const byLayer = order.map(k => graph.nodes.filter(n => n.layer === k).sort((a, b) => a.order - b.order));
    const laneWidth = list => list.reduce((s, n) => s + width(n), 0) + GAP * Math.max(0, list.length - 1);
    const contentW = Math.max(MIN_W, ...byLayer.map(laneWidth));
    const svgH = order.length * LANE_H;
    // Arrows that skip lanes (e.g. to the Builder or the Validator) are routed through the gaps
    // between lanes and down a free column, so they cross no box; a margin on each side leaves
    // room for a column outside every box.
    const laneOf = id => order.indexOf(graph.nodes.find(n => n.id === id).layer);
    const skips = graph.edges.filter(e => laneOf(e.to) - laneOf(e.from) > 1);
    const reserve = skips.length ? 34 : 0;
    const left = LABEL_W + PAD + reserve;
    const svgW = left + contentW + reserve + PAD;
    const pos = new Map();
    byLayer.forEach((list, li) => {
      let x = left + (contentW - laneWidth(list)) / 2;
      for (const n of list) {
        const w = width(n);
        pos.set(n.id, { x, y: li * LANE_H + (LANE_H - NODE_H) / 2, w, h: NODE_H, lane: li });
        x += w + GAP;
      }
    });
    // A column for a lane-skipping arrow: x clear of every box (with a margin) in the lanes it
    // passes, nearest the middle of its two ends.
    const column = (e, x1, x2) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      const blocks = [...pos.values()].filter(p => p.lane > a.lane && p.lane < b.lane)
        .map(p => [p.x - 10, p.x + p.w + 10]).sort((u, v) => u[0] - v[0]);
      const merged = [];
      for (const [l, r] of blocks) {
        const last = merged[merged.length - 1];
        if (last && l <= last[1]) last[1] = Math.max(last[1], r); else merged.push([l, r]);
      }
      const want = (x1 + x2) / 2;
      const free = x => !merged.some(([l, r]) => x > l && x < r);
      const candidates = [want, x1, x2, ...merged.flat()].filter(free);
      return candidates.reduce((best, x) => (Math.abs(x - want) < Math.abs(best - want) ? x : best), candidates[0]);
    };

    // Fan out several arrows leaving or entering one box.
    const ends = (list, key, otherKey) => {
      const at = new Map();
      for (const id of new Set(list.map(e => e[key]))) {
        const mine = list.filter(e => e[key] === id).sort((a, b) => pos.get(a[otherKey]).x - pos.get(b[otherKey]).x);
        const p = pos.get(id);
        const step = Math.min(16, p.w / (mine.length + 1));
        mine.forEach((e, k) => at.set(e.id, p.x + p.w / 2 + (k - (mine.length - 1) / 2) * step));
      }
      return at;
    };
    const outX = ends(graph.edges, 'from', 'to');
    const inX = ends(graph.edges, 'to', 'from');

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" role="img" aria-label="Process diagram of the API flow">`);
    parts.push('<defs>' + ['edge', 'on', 'response'].map(k =>
      `<marker id="dg-arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-head-${k}"/></marker>`).join('') + '</defs>');

    order.forEach((k, li) => {
      const y = li * LANE_H;
      const title = LAYERS.find(l => l[0] === k)[1];
      const sub = lanes[k] ? String(lanes[k]) : '';
      parts.push(`<g class="dg-lane${li % 2 ? ' dg-odd' : ''}"><rect x="0" y="${y}" width="${svgW}" height="${LANE_H}"/>` +
        `<text x="14" y="${y + LANE_H / 2 - (sub ? 4 : -4)}" class="dg-lane-title">${esc(title)}</text>` +
        (sub ? `<text x="14" y="${y + LANE_H / 2 + 13}" class="dg-lane-sub">${esc(sub.length > 24 ? sub.slice(0, 23) + '…' : sub)}<title>${esc(sub)}</title></text>` : '') +
        '</g>');
    });

    // Arrows first, so boxes sit on top; the highlighted row's arrows last.
    const edges = [...graph.edges].sort((a, b) => on(a) - on(b));
    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      const x1 = outX.get(e.id);
      const y1 = a.y + a.h;
      const x2 = inX.get(e.id);
      const y2 = b.y;
      let d;
      if (skips.includes(e)) {
        // Down into the gap below its lane, along it to a free column, down the column, along the
        // gap above the target lane, and into the target. Gaps hold no boxes; a small offset per
        // arrow keeps parallel runs apart.
        const k = (skips.indexOf(e) % 5) - 2;
        const gapBelow = (a.lane + 1) * LANE_H + k * 3;
        const gapAbove = b.lane * LANE_H + k * 3;
        const cx = column(e, x1, x2);
        d = `M${x1},${y1} L${x1},${gapBelow} L${cx},${gapBelow} L${cx},${gapAbove} L${x2},${gapAbove} L${x2},${y2}`;
      } else {
        const dy = Math.max(26, (y2 - y1) / 2);
        d = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
      }
      const state = on(e) ? (e.kind === 'response' ? 'response' : 'on') : 'edge';
      parts.push(`<path class="dg-edge dg-${e.kind} ${on(e) ? 'dg-on' : 'dg-off'}" d="${d}" marker-end="url(#dg-arrow-${state})"><title>${esc(e.label)}</title></path>`);
    }

    for (const n of graph.nodes) {
      const p = pos.get(n.id);
      const tip = `${LAYERS.find(l => l[0] === n.layer)[1]}: ${n.label}${n.sub ? ` · ${n.sub}` : ''}`;
      const attrs = n.ref ? ` data-pane="${n.ref.pane}" data-line="${n.ref.line}" tabindex="0" role="button"` : '';
      parts.push(`<g class="dg-node dg-${n.layer} ${on(n) ? 'dg-on' : 'dg-off'}" data-rows="${n.rows.join(',')}"${attrs} aria-label="${esc(tip)}">` +
        `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8"/>` +
        `<text x="${p.x + p.w / 2}" y="${p.y + (n.sub ? 19 : 28)}" class="dg-label">${esc(n.label.length > MAX_LABEL ? n.label.slice(0, MAX_LABEL - 1) + '…' : n.label)}</text>` +
        (n.sub ? `<text x="${p.x + p.w / 2}" y="${p.y + 35}" class="dg-sub">${esc(n.sub.length > 46 ? n.sub.slice(0, 45) + '…' : n.sub)}</text>` : '') +
        `<title>${esc(tip)}</title></g>`);
    }
    parts.push('</svg>');
    return parts.join('');
  }

  const api = { flowGraph, toSvg, routeLabel, routeFits, LAYERS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.StoryZDiagram = api;
})();
