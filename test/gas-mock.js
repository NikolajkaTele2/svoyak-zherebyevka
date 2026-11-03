// Имитация Google Apps Script (SpreadsheetApp и др.) для проверки gas/Code.gs без Google.
// Проверяет то, на чём падает настоящая таблица: выход за границы листа, размеры массивов,
// пересекающиеся объединения, объединения поперёк закреплённой области.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEnv() {
  const fail = (m) => { throw new Error('Google: ' + m); };
  function Sheet(name) {
    this.name = name; this.cells = {}; this.merges = []; this.borders = []; this.widths = {}; this.heights = {};
    this.maxR = 1000; this.maxC = 26; this.frozen = [0, 0]; this.tab = null; this.wrap = [];
  }
  Sheet.prototype = {
    getName() { return this.name; },
    getIndex() { return ss.sheets.indexOf(this) + 1; },
    getMaxRows() { return this.maxR; }, getMaxColumns() { return this.maxC; },
    insertRowsAfter(a, n) { this.maxR += n; }, insertColumnsAfter(a, n) { this.maxC += n; },
    clear() { this.cells = {}; this.borders = []; this.wrap = []; return this; },
    clearConditionalFormatRules() {},
    setFrozenRows(n) { this.frozen[0] = n; this.checkFrozen(); }, setFrozenColumns(n) { this.frozen[1] = n; this.checkFrozen(); },
    checkFrozen() {
      const [fr, fc] = this.frozen;
      this.merges.forEach(([r, c, nr, nc]) => {
        if (fr && r <= fr && r + nr - 1 > fr) fail('объединение поперёк закреплённых строк');
        if (fc && c <= fc && c + nc - 1 > fc) fail('объединение поперёк закреплённых столбцов');
      });
    },
    setColumnWidth(c, w) { this.widths[c] = w; }, setRowHeight(r, h) { this.heights[r] = h; },
    setTabColor(c) { this.tab = c; },
    getRange(r, c, nr, nc) {
      if (nc === undefined || nr === undefined) fail('getRange без размеров');
      if (r < 1 || c < 1 || nr < 1 || nc < 1) fail('диапазон ' + [r, c, nr, nc]);
      if (r + nr - 1 > this.maxR || c + nc - 1 > this.maxC) fail('диапазон за границей листа ' + [r, c, nr, nc] + ' > ' + this.maxR + '×' + this.maxC);
      return new Range(this, r, c, nr, nc);
    },
    cell(r, c) { const k = r + ':' + c; return (this.cells[k] = this.cells[k] || {}); },
  };
  function Range(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  const grid = (attr) => function (A) {
    if (!Array.isArray(A) || A.length !== this.nr || A.some((row) => !Array.isArray(row) || row.length !== this.nc)) fail(attr + ': размер массива не совпадает с диапазоном');
    A.forEach((row, i) => row.forEach((v, j) => {
      if (attr === 'v' && v !== '' && typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') fail('значение ' + typeof v);
      this.sh.cell(this.r + i, this.c + j)[attr] = v;
    }));
    return this;
  };
  const each = (attr) => function (v) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.cell(this.r + i, this.c + j)[attr] = v; return this; };
  Range.prototype = {
    setValues(A) { if (this.sh.broken) fail('на листе есть умная таблица'); return grid('v').call(this, A); }, setBackgrounds: grid('bg'), setFontWeights: grid('fw'), setHorizontalAlignments: grid('al'), setFontColors: grid('fc'), setFontSizes: grid('fs'),
    setNumberFormat: each('fmt'), setFontFamily: each('ff'), setVerticalAlignment: each('va'),
    setWrap(w) { this.sh.wrap.push([this.r, this.c, this.nr, this.nc, w]); return this; },
    merge() {
      const a = [this.r, this.c, this.nr, this.nc];
      const ov = (m) => !(m[0] + m[2] - 1 < a[0] || a[0] + a[2] - 1 < m[0] || m[1] + m[3] - 1 < a[1] || a[1] + a[3] - 1 < m[1]);
      if (this.sh.merges.some(ov)) fail('объединение пересекается с другим');
      this.sh.merges.push(a); this.sh.checkFrozen(); return this;
    },
    breakApart() {
      const a = [this.r, this.c, this.nr, this.nc];
      this.sh.merges = this.sh.merges.filter((m) => m[0] + m[2] - 1 < a[0] || a[0] + a[2] - 1 < m[0] || m[1] + m[3] - 1 < a[1] || a[1] + a[3] - 1 < m[1]);
      return this;
    },
    setBorder(...args) { if (args.length !== 8) fail('setBorder: 8 аргументов'); this.sh.borders.push([this.r, this.c, this.nr, this.nc, args[2] && !args[0] ? 'bottom' : 'all']); return this; },
  };
  const ss = {
    title: 'Чемпионат (тест)', sheets: [new Sheet('Лист1')],
    getName() { return this.title; },
    getSheets() { return this.sheets.slice(); },
    getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; },
    deleteSheet(sh) { if (this.sheets.length === 1) fail('нельзя удалить единственный лист'); this.sheets = this.sheets.filter((x) => x !== sh); },
    insertSheet(n, i) { if (this.getSheetByName(n)) fail('лист уже есть'); const s = new Sheet(n); this.sheets.splice(i, 0, s); return s; },
  };
  const props = {};
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM' }, flush() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { if (String(v).length > 9000) fail('свойство больше 9 КБ: ' + k + ' ' + String(v).length); props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
      createTextOutput: (s) => ({ s, mime: 'text', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.s; } }),
    },
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
  vm.runInContext(code + '\n;globalThis.__api = { doPost, doGet, handle_, seasonRows_, reset_, KEY };', ctx);
  const api = ctx.__api;
  const post = (body) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  const get = (params) => api.doGet({ parameter: params }).getContent();
  return { api, ss, props, post, get };
}

/* Лист → простая структура для проверки и для отрисовки в .xlsx */
function dump(sh) {
  return { name: sh.name, tab: sh.tab, cells: sh.cells, merges: sh.merges, borders: sh.borders, widths: sh.widths, heights: sh.heights, frozen: sh.frozen };
}

module.exports = { makeEnv, dump };
