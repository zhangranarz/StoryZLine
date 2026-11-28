// Reads the first sheet of an .xlsx file (or a .csv) into rows, and turns rows with
// Bitbucket URL / Project key / Repository headers into pick-list entries. No libraries: an .xlsx file is a zip of XML files, unzipped with
// the browser's built-in DecompressionStream. Shared by the browser page and the Node tests.
(function () {
  'use strict';

  class ExcelError extends Error {}

  // ---- zip ----------------------------------------------------------------------------

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Returns { name: async () => Uint8Array } for every file in the zip.
  function readZip(buf) {
    const bytes = new Uint8Array(buf);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new ExcelError('This is not an .xlsx file (or it is damaged). Save it from Excel as .xlsx or .csv.');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const files = {};
    const decoder = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new ExcelError('The .xlsx file is damaged.');
      const method = view.getUint16(p + 10, true);
      const size = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      files[name] = async () => {
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const data = bytes.subarray(start, start + size);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new ExcelError(`Unsupported compression in ${name}.`);
      };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  // ---- xlsx ---------------------------------------------------------------------------

  function decodeXml(s) {
    return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (m, hex, dec, named) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(Number(dec));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named.toLowerCase()];
    });
  }

  // All <t> text inside a fragment (rich text is split over several <r><t> runs).
  function textOf(xml) {
    let out = '';
    for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
    return out;
  }

  function attr(tag, name) {
    const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
    return m ? decodeXml(m[1]) : null;
  }

  function columnIndex(ref) {
    const letters = (ref.match(/^[A-Z]+/i) || [''])[0].toUpperCase();
    let n = 0;
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  }

  async function readXlsx(buf) {
    const zip = readZip(buf);
    const text = async name => (zip[name] ? new TextDecoder().decode(await zip[name]()) : null);

    // Find the first sheet's file through the workbook relationships.
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const workbook = await text('xl/workbook.xml');
    const rels = await text('xl/_rels/workbook.xml.rels');
    if (workbook && rels) {
      const firstSheet = workbook.match(/<sheet\s[^>]*>/);
      const rid = firstSheet && attr(firstSheet[0], 'r:id');
      for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
        if (attr(m[0], 'Id') === rid) {
          const target = attr(m[0], 'Target');
          sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
        }
      }
    }
    const sheet = await text(sheetPath);
    if (!sheet) throw new ExcelError('Could not find the first worksheet in the .xlsx file.');

    const sharedXml = await text('xl/sharedStrings.xml');
    const shared = sharedXml ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];

    const rows = [];
    for (const r of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row = [];
      for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = '<c' + c[1] + '>';
        const body = c[2] || '';
        const ref = attr(tag, 'r');
        const idx = ref ? columnIndex(ref) : row.length;
        const type = attr(tag, 't');
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = '';
        if (type === 's') value = shared[Number(v)] || '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null) value = decodeXml(v);
        row[idx] = value;
      }
      rows.push(Array.from(row, x => (x == null ? '' : String(x))));
    }
    return rows;
  }

  // ---- csv ----------------------------------------------------------------------------

  function readCsv(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delim = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // ---- pick list ----------------------------------------------------------------------

  // Other columns (Branch, notes, ...) are ignored.
  const COLUMNS = [
    { key: 'baseUrl', label: 'Bitbucket URL', match: h => h.includes('bitbucket') || h === 'url' || h === 'baseurl' },
    { key: 'project', label: 'Project key', match: h => h.startsWith('project') || h === 'workspace' },
    { key: 'repo', label: 'Repository', match: h => h.startsWith('repo') },
  ];
  // A blank cell in these columns means "same as the row above", as with merged cells.
  const FILL_DOWN = ['baseUrl', 'project'];

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Finds the header row (within the first 10 rows) and returns { entries, columns }.
  function toEntries(rows) {
    for (let h = 0; h < Math.min(rows.length, 10); h++) {
      const headers = rows[h].map(norm);
      const map = {};
      for (const col of COLUMNS) {
        const i = headers.findIndex((x, j) => x && col.match(x) && !Object.values(map).includes(j));
        if (i >= 0) map[col.key] = i;
      }
      if (COLUMNS.every(c => c.key in map)) {
        const entries = [];
        const seen = new Set();
        let above = {};
        for (const r of rows.slice(h + 1)) {
          const e = {};
          for (const col of COLUMNS) e[col.key] = String(r[map[col.key]] || '').trim();
          if (!e.repo) continue;  // a row without a repository is blank or a note
          for (const k of FILL_DOWN) if (!e[k]) e[k] = above[k] || '';
          if (!e.baseUrl || !e.project) continue;
          above = e;
          const id = COLUMNS.map(c => e[c.key]).join('\u0000');
          if (!seen.has(id)) { seen.add(id); entries.push(e); }
        }
        if (!entries.length) throw new ExcelError('The sheet has the right headers but no filled-in rows.');
        return { entries, columns: COLUMNS.map(c => c.key) };
      }
    }
    throw new ExcelError('Could not find the header row. The first sheet needs columns named "Bitbucket URL", "Project key" and "Repository".');
  }

  async function readTable(name, buf) {
    if (/\.csv$|\.txt$/i.test(name)) return readCsv(new TextDecoder().decode(buf));
    if (/\.xls$/i.test(name)) throw new ExcelError('Old .xls files are not supported. In Excel use File > Save As > Excel Workbook (.xlsx) or CSV.');
    return readXlsx(buf);
  }

  const TEMPLATE_CSV = 'Bitbucket URL,Project key,Repository\r\n' +
    'https://bitbucket.yourcompany.com,ECOM,ecomm-api\r\n' +
    ',,ecomm-batch\r\n';

  const api = { readTable, readXlsx, readCsv, toEntries, readZip, COLUMNS, TEMPLATE_CSV, ExcelError };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.StoryZExcel = api;
})();
