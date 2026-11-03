/**
 * «Своя игра: швейцарская жеребьёвка» → Google Таблица сезона.
 *
 * Приложение присылает готовый снимок тура (всё уже посчитано), скрипт рисует листы
 * «Тур N Бои», «Тур N Таблица» и пересчитывает «Отбор Таблица».
 * Другие листы таблицы скрипт не трогает.
 *
 * Установка: Расширения → Apps Script → вставить этот файл вместо содержимого Code.gs →
 * заменить ключ ниже → Развернуть → Новое развертывание → Веб-приложение,
 * «Запуск от имени: я», «Доступ: все» → скопировать ссылку в приложение.
 */
const KEY = 'поменяй-меня'; // секретное слово: то же самое вводится в приложении

const ORDER = ['Тур 1 Бои', 'Тур 1 Таблица', 'Тур 2 Бои', 'Тур 2 Таблица', 'Тур 3 Бои', 'Тур 3 Таблица', 'Тур 4 Бои', 'Тур 4 Таблица', 'Отбор Таблица'];
const TAB = { 1: '#ff0000', 2: '#4a86e8', 3: '#ff9900', 4: '#9900ff', 0: '#980000' };
const YEL = '#f7cb4d', CREAM = '#fef8e3', GREEN = '#d9ead3', MUTED = '#666666';
// цвет боя в таблице тура: участники одного боя в одном круге — одного цвета
const BATTLE = ['#f4b4b4', '#a8d8f0', '#f7e39a', '#c9b8ee', '#b5e3b0', '#f6c29c', '#9ee0d6', '#f0b8dc', '#d9e3a0', '#d8c8b0', '#dadada', '#c4ccf4', '#fcdcc4', '#d4eec4', '#f2d4f0', '#c8ecec'];
const px = (w) => Math.round(w * 7 + 5); // ширина как в Excel → пиксели

/* ---------- приём ---------- */
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad-json' }); }
  try {
    return out_(handle_(req));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return out_({ ok: false, error: 'exception', message: String((err && err.message) || err) });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.act) return ContentService.createTextOutput('Скрипт заливки «Своей игры» работает. Ссылку вставьте в приложение.');
  let res;
  if (p.key !== KEY) res = { ok: false, error: 'key' };
  else if (p.act === 'status') res = status_();
  else res = { ok: false, error: 'act' };
  return out_(res, p.callback);
}

function out_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function status_() {
  const reg = registry_(), tours = {};
  for (let t = 1; t <= 4; t++) if (reg[t]) tours[t] = { id: reg[t].id, name: reg[t].name, savedAt: reg[t].savedAt };
  return { ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName(), tours };
}

function handle_(req) {
  if (!req || req.key !== KEY) return { ok: false, error: 'key' };
  const tour = Number(req.tour), snap = req.snap;
  if (!(tour >= 1 && tour <= 4) || !snap || !Array.isArray(snap.rounds)) return { ok: false, error: 'data' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'busy' };
  try {
    const reg = registry_(), cur = reg[tour];
    if (cur && cur.id && snap.id && cur.id !== snap.id && !req.force) return { ok: false, error: 'conflict', tour, other: cur.name };
    if (cur && cur.id === snap.id && (cur.savedAt || 0) > (snap.savedAt || 0)) return { ok: true, stale: true, tour, savedAt: cur.savedAt };
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    draw_(ss, 'Тур ' + tour + ' Бои', TAB[tour], (sh) => drawBattles_(sh, snap));
    draw_(ss, 'Тур ' + tour + ' Таблица', TAB[tour], (sh) => drawTable_(sh, snap));
    reg[tour] = { id: snap.id, name: snap.name, savedAt: snap.savedAt, result: snap.result || null };
    PropertiesService.getScriptProperties().setProperty('tour' + tour, JSON.stringify(reg[tour]));
    draw_(ss, 'Отбор Таблица', TAB[0], (sh) => drawSeason_(sh, reg));
    SpreadsheetApp.flush();
    return { ok: true, tour, savedAt: snap.savedAt };
  } finally {
    lock.releaseLock();
  }
}

function registry_() {
  const props = PropertiesService.getScriptProperties(), reg = {};
  for (let t = 1; t <= 4; t++) {
    const raw = props.getProperty('tour' + t);
    if (raw) try { reg[t] = JSON.parse(raw); } catch (e) {}
  }
  return reg;
}

/* Убрать тур из «Отбора» и снять привязку к турниру (запускается вручную из редактора). */
function resetTour1() { reset_(1); }
function resetTour2() { reset_(2); }
function resetTour3() { reset_(3); }
function resetTour4() { reset_(4); }
function reset_(t) {
  PropertiesService.getScriptProperties().deleteProperty('tour' + t);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  draw_(ss, 'Отбор Таблица', TAB[0], (sh) => drawSeason_(sh, registry_()));
}

/* ---------- листы ---------- */
function sheet_(ss, name, color) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    const i = ORDER.indexOf(name);
    let at = 0;
    ss.getSheets().forEach((s, k) => { const j = ORDER.indexOf(s.getName()); if (j >= 0 && j < i) at = k + 1; });
    sh = ss.insertSheet(name, at);
  }
  sh.setTabColor(color);
  return sh;
}

/* Нарисовать лист; если на старом листе что-то мешает (защита, фильтр, «умная» таблица),
   лист пересоздаётся на том же месте и рисуется заново. */
function draw_(ss, name, color, fn) {
  try {
    fn(sheet_(ss, name, color));
  } catch (err) {
    console.warn('Лист «' + name + '»: ' + (err && err.message) + ' — пересоздаю');
    const old = ss.getSheetByName(name);
    if (!old) throw new Error('Лист «' + name + '»: ' + ((err && err.message) || err));
    const at = old.getIndex() - 1;
    if (ss.getSheets().length === 1) ss.insertSheet('Временный', 0);
    ss.deleteSheet(old);
    const sh = ss.insertSheet(name, at);
    sh.setTabColor(color);
    try { fn(sh); } catch (err2) { throw new Error('Лист «' + name + '»: ' + ((err2 && err2.message) || err2)); }
    const tmp = ss.getSheetByName('Временный'); if (tmp) ss.deleteSheet(tmp);
  }
}

/* Сетка ячеек: put(r, c, значение, {bg, b, al, color, size}); затем paint_ пишет всё разом. */
function grid_() {
  const g = { cells: {}, R: 0, C: 0, merges: [], borders: [], formats: [] };
  g.put = (r, c, v, o) => {
    g.cells[r + ':' + c] = Object.assign({ v: v === null || v === undefined ? '' : v }, o || {});
    if (r > g.R) g.R = r; if (c > g.C) g.C = c;
  };
  g.box = (r, c, nr, nc, style) => g.borders.push([r, c, nr, nc, style || 'all']);
  g.merge = (r, c, nr, nc) => g.merges.push([r, c, nr, nc]);
  g.format = (r, c, nr, nc, f) => g.formats.push([r, c, nr, nc, f]);
  return g;
}

function paint_(sh, g, widths, heights, frozen) {
  const R = Math.max(g.R, 1, ...Object.keys(heights || {}).map(Number)), C = Math.max(g.C, 1, ...Object.keys(widths || {}).map(Number));
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.setFrozenRows(0); sh.setFrozenColumns(0);
  if (sh.getMaxRows() < R) sh.insertRowsAfter(sh.getMaxRows(), R - sh.getMaxRows());
  if (sh.getMaxColumns() < C) sh.insertColumnsAfter(sh.getMaxColumns(), C - sh.getMaxColumns());
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  const V = [], BG = [], FW = [], AL = [], FC = [], FS = [];
  for (let r = 1; r <= R; r++) {
    const v = [], bg = [], fw = [], al = [], fc = [], fs = [];
    for (let c = 1; c <= C; c++) {
      const x = g.cells[r + ':' + c] || { v: '' };
      v.push(x.v); bg.push(x.bg || null); fw.push(x.b ? 'bold' : 'normal'); al.push(x.al || 'center'); fc.push(x.color || '#000000'); fs.push(x.size || 10);
    }
    V.push(v); BG.push(bg); FW.push(fw); AL.push(al); FC.push(fc); FS.push(fs);
  }
  const all = sh.getRange(1, 1, R, C);
  g.formats.forEach(([r, c, nr, nc, f]) => sh.getRange(r, c, nr, nc).setNumberFormat(f));
  all.setValues(V).setBackgrounds(BG).setFontWeights(FW).setHorizontalAlignments(AL).setFontColors(FC).setFontSizes(FS)
    .setFontFamily('Arial').setVerticalAlignment('middle');
  g.merges.forEach(([r, c, nr, nc]) => sh.getRange(r, c, nr, nc).merge());
  const S = SpreadsheetApp.BorderStyle;
  g.borders.forEach(([r, c, nr, nc, st]) => {
    const rg = sh.getRange(r, c, nr, nc);
    if (st === 'bottom') rg.setBorder(null, null, true, null, null, null, '#000000', S.SOLID_MEDIUM);
    else rg.setBorder(true, true, true, true, true, true, '#000000', S.SOLID);
  });
  Object.keys(widths).forEach((c) => sh.setColumnWidth(Number(c), px(widths[c])));
  Object.keys(heights || {}).forEach((r) => sh.setRowHeight(Number(r), heights[r]));
  if (frozen) { sh.setFrozenRows(frozen[0]); sh.setFrozenColumns(frozen[1]); }
}

const surname_ = (n) => (n ? String(n).split(' ')[0] : '');
const num_ = (p) => (p !== null && p !== undefined && /^\d+$/.test(String(p)) ? Number(p) : p);
const f2_ = (x) => (Math.round(x * 100) / 100).toFixed(2);

/* «Тур N Бои»: круги друг под другом, волны внутри круга, площадки слева направо. */
function drawBattles_(sh, snap) {
  const g = grid_(), SIZE = 4;
  let V = 1;
  snap.rounds.forEach((rd) => rd.battles.forEach((b) => { if (b.venue + 1 > V) V = b.venue + 1; }));
  const widths = { 1: 7.2, 2: 3.9 };
  for (let v = 0; v < V; v++) { const c0 = 3 + 5 * v; widths[c0] = 5.5; widths[c0 + 1] = 29; widths[c0 + 2] = 7.2; widths[c0 + 3] = 7.2; widths[c0 + 4] = 3.9; }
  let r0 = 2;
  snap.rounds.forEach((rd, k) => {
    const W = Math.max(1, ...rd.battles.map((b) => b.slot || 1));
    const span = W * (SIZE + 2) - 1;
    for (let r = r0; r < r0 + span; r++) g.put(r, 1, r === r0 ? 'Круг ' + (k + 1) : '', { bg: YEL });
    g.merge(r0, 1, span, 1); g.box(r0, 1, span, 1);
    const vname = {};
    rd.battles.forEach((b) => { if (b.venueName) vname[b.venue] = b.venueName; });
    for (let w = 1; w <= W; w++) {
      const hr = r0 + (w - 1) * (SIZE + 2);
      for (let v = 0; v < V; v++) {
        const c0 = 3 + 5 * v, b = rd.battles.find((x) => x.venue === v && (x.slot || 1) === w);
        let title = vname[v] || '';
        if (b) title = b.n + '.' + (title ? ' ' + title : ' Бой') + (b.host ? ' (' + surname_(b.host) + ')' : '');
        g.put(hr, c0, '№', { bg: CREAM }); g.put(hr, c0 + 1, title, { bg: CREAM }); g.put(hr, c0 + 2, 'Баллы', { bg: CREAM }); g.put(hr, c0 + 3, 'Очки', { bg: CREAM });
        for (let i = 0; i < SIZE; i++) {
          const p = b && b.players[i];
          g.put(hr + 1 + i, c0, p ? p.seed : '', { bg: CREAM });
          g.put(hr + 1 + i, c0 + 1, p ? p.name : '', { bg: CREAM, al: 'left' });
          g.put(hr + 1 + i, c0 + 2, p && p.score !== null ? p.score : '', { bg: GREEN });
          g.put(hr + 1 + i, c0 + 3, p && p.pts !== null ? p.pts : '', { bg: CREAM });
        }
        g.box(hr, c0, SIZE + 1, 4);
        g.format(hr + 1, c0 + 3, SIZE, 1, '0.00');
      }
    }
    r0 += span + 1;
  });
  paint_(sh, g, widths, { 1: 8 }, null);
}

/* «Тур N Таблица»: место, круги «очки / баллы» в цвете боя, итог тура, финал. */
function drawTable_(sh, snap) {
  const g = grid_();
  const heads = ['Место', 'Участник', '1', '2', '3', '4', 'Очки', 'Баллы', 'Сила соп.', 'Финал', 'Итог. место', 'Кубк. очки'];
  heads.forEach((h, i) => g.put(1, i + 1, h, { b: true }));
  const n = snap.table.length;
  snap.table.forEach((r, i) => {
    const row = i + 2;
    g.put(row, 1, num_(r.place)); g.put(row, 2, r.name, { al: 'left' });
    for (let t = 0; t < 4; t++) {
      const x = r.rounds[t];
      g.put(row, 3 + t, x ? f2_(x.pts) + ' / ' + x.score : '', x ? { bg: BATTLE[(x.battle - 1) % BATTLE.length] } : null);
    }
    g.put(row, 7, r.pts); g.put(row, 8, r.score); g.put(row, 9, r.opp);
    g.put(row, 10, r.finalist ? 'финал' : '', r.finalist ? { bg: GREEN } : null);
    g.put(row, 11, num_(r.finalPlace)); g.put(row, 12, r.cup);
  });
  if (n) {
    g.box(1, 1, n + 1, heads.length);
    g.format(2, 7, n, 1, '0.00'); g.format(2, 9, n, 1, '0.00');
    if (snap.played && n > 3) g.box(4, 1, 1, heads.length, 'bottom');
  }
  if (snap.final) {
    const fr = n + 3;
    g.put(fr, 2, 'Финал тура', { b: true, bg: YEL }); g.put(fr, 3, 'Баллы', { b: true, bg: YEL }); g.put(fr, 4, 'Место', { b: true, bg: YEL });
    snap.final.players.forEach((f, i) => {
      g.put(fr + 1 + i, 2, f.name, { al: 'left' }); g.put(fr + 1 + i, 3, f.score === null ? '' : f.score, { bg: GREEN }); g.put(fr + 1 + i, 4, num_(f.place));
    });
    g.box(fr, 2, snap.final.players.length + 1, 3);
    if (snap.final.host) g.put(fr + 1 + snap.final.players.length, 2, 'Ведущий: ' + snap.final.host, { al: 'left', color: MUTED, size: 9 });
  }
  const widths = { 1: 7, 2: 22, 3: 11, 4: 11, 5: 11, 6: 11, 7: 7, 8: 7, 9: 8.5, 10: 7, 11: 8.5, 12: 8.5 };
  paint_(sh, g, widths, { 1: 34 }, [1, 2]);
  sh.getRange(1, 1, 1, heads.length).setWrap(true);
}

/* «Отбор Таблица»: сумма кубковых очков без худшего результата. */
function seasonRows_(reg) {
  const key = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const people = {};
  for (let t = 1; t <= 4; t++) {
    const res = reg[t] && reg[t].result;
    (res || []).forEach((r) => {
      const k = key(r.name);
      people[k] = people[k] || { name: r.name, res: {} };
      people[k].name = r.name;
      people[k].res[t] = { place: r.place, cup: r.cup };
    });
  }
  const rows = Object.keys(people).map((k) => {
    const p = people[k];
    const vals = [1, 2, 3, 4].map((t) => (p.res[t] ? p.res[t].cup : 0)).map((v) => (v === null || v === undefined || v === '?' ? 0 : v));
    const fc = vals.filter((v) => v === 'Ф').length;
    const nums = vals.filter((v) => v !== 'Ф').map(Number);
    const tot = Math.round((nums.reduce((a, b) => a + b, 0) - (nums.length ? Math.min(...nums) : 0)) * 100) / 100;
    const played = Object.keys(p.res).map((t) => p.res[t].cup).filter((v) => v !== null && v !== undefined && v !== '?');
    const best = fc ? 'Ф' : played.length ? Math.max(...played.map(Number)) : 0;
    return { name: p.name, res: p.res, fc, tot, best };
  });
  const bestN = (b) => (b === 'Ф' ? 1e9 : b);
  rows.sort((a, b) => b.fc - a.fc || b.tot - a.tot || bestN(b.best) - bestN(a.best) || a.name.localeCompare(b.name, 'ru'));
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].fc === rows[i].fc && rows[j + 1].tot === rows[i].tot && bestN(rows[j + 1].best) === bestN(rows[i].best)) j++;
    for (let k = i; k <= j; k++) rows[k].place = i === j ? i + 1 : i + 1 + '–' + (j + 1);
    i = j + 1;
  }
  return rows;
}

function drawSeason_(sh, reg) {
  const g = grid_();
  for (let c = 1; c <= 12; c++) { g.put(1, c, '', { bg: YEL }); g.put(2, c, '', { bg: YEL }); }
  g.put(1, 1, 'Место', { bg: YEL }); g.put(1, 2, 'Участник', { bg: YEL }); g.put(1, 11, 'Сумма без худшего', { bg: YEL }); g.put(1, 12, 'Лучший результат', { bg: YEL });
  for (let t = 0; t < 4; t++) { g.put(1, 3 + 2 * t, 'Тур ' + (t + 1), { bg: YEL }); g.put(2, 3 + 2 * t, 'Место', { bg: YEL }); g.put(2, 4 + 2 * t, 'Очки', { bg: YEL }); g.merge(1, 3 + 2 * t, 1, 2); }
  [1, 2, 11, 12].forEach((c) => g.merge(1, c, 2, 1));
  const rows = seasonRows_(reg);
  rows.forEach((r, i) => {
    const row = i + 3, bg = i % 2 === 0 ? CREAM : null;
    g.put(row, 1, r.place, { bg }); g.put(row, 2, r.name, { bg, al: 'left' });
    for (let t = 0; t < 4; t++) {
      const x = r.res[t + 1];
      g.put(row, 3 + 2 * t, x ? num_(x.place) : '', { bg }); g.put(row, 4 + 2 * t, x && x.cup !== null ? x.cup : '', { bg });
    }
    g.put(row, 11, r.tot, { bg }); g.put(row, 12, r.best, { bg });
  });
  g.box(1, 1, rows.length + 2, 12);
  const widths = { 1: 7, 2: 22, 11: 10.5, 12: 10.5 };
  for (let c = 3; c <= 10; c++) widths[c] = 7;
  paint_(sh, g, widths, { 1: 30 }, [2, 2]);
  sh.getRange(1, 1, 2, 12).setWrap(true);
}
