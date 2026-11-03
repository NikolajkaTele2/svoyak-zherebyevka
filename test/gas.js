// Заливка в Google Таблицу: снимок из ядра → gas/Code.gs на имитации Google.
const SG = require('../src/engine.js');
const { makeEnv } = require('./gas-mock.js');
const assert = (c, m) => { if (!c) { console.error('ОШИБКА:', m); process.exit(1); } };

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function tournament(N, id, opts = {}) {
  const st = { id, name: 'Тест ' + id, savedAt: 1000, settings: { venues: opts.noVenues ? { count: 0 } : { count: 5, perVenue: 2, names: ['Зал', 'Холл', 'N 7', 'N 6', 'N 5'] } }, players: [], tours: [], hosts: [], shootouts: {} };
  for (let i = 0; i < N; i++) st.players.push({ id: 'q' + i, name: 'Игрок' + i + ' Тестов', rating: 2000 - i * 7 });
  st.hosts = st.players.filter((_, i) => i % 2).map((p) => p.id);
  const rounds = opts.rounds ?? 4;
  for (let t = 0; t < rounds; t++) {
    const d = SG.drawNext(st);
    const tr = SG.placeTour({ battles: d.battles }, st.settings.venues, st.hosts, SG.hostBlocked(st.tours, t), 'venue');
    if (!(opts.lastEmpty && t === rounds - 1)) tr.battles.forEach((b) => b.players.forEach((p) => (b.scores[p] = Math.round(rnd() * 30 - 5) * 10)));
    st.tours.push(tr);
  }
  if (rounds === 4 && !opts.lastEmpty && !opts.noFinal) {
    const sh = SG.standings(st, 4).shootout;
    if (sh) st.shootouts[sh.key] = sh.ids;
    const ids = SG.standings(st, 4).slice(0, 3).map((r) => r.id);
    st.final = { players: ids, scores: { [ids[0]]: 300, [ids[1]]: 200, [ids[2]]: 100 }, host: null };
  }
  return st;
}

const env = makeEnv();
const { post, get, ss, api } = env;
const K = api.KEY;
const cell = (sh, r, c) => (ss.getSheetByName(sh).cells[r + ':' + c] || {});

// 1. Ключ
assert(post({ key: 'нет', tour: 1, snap: { rounds: [] } }).error === 'key', 'неверный ключ отклоняется');
assert(JSON.parse(get({ act: 'status', key: 'нет' })).error === 'key', 'статус без ключа');

// 2. Полный тур 1
const A = tournament(31, 'A');
let r = post({ key: K, tour: 1, snap: SG.sheetSnapshot(A) });
assert(r.ok && !r.stale, 'тур 1 залит: ' + JSON.stringify(r));
const names = ss.getSheets().map((s) => s.name);
assert(names.slice(0, 3).join() === 'Тур 1 Бои,Тур 1 Таблица,Отбор Таблица' && names[3] === 'Лист1', 'порядок листов: ' + names);
const snapA = SG.sheetSnapshot(A);
const b1 = snapA.rounds[0].battles[0];
assert(cell('Тур 1 Бои', 2, 1).v === 'Круг 1', 'плашка круга');
assert(String(cell('Тур 1 Бои', 2, 4).v).startsWith('1. Зал'), 'заголовок боя: ' + cell('Тур 1 Бои', 2, 4).v);
assert(cell('Тур 1 Бои', 3, 4).v === b1.players[0].name && cell('Тур 1 Бои', 3, 5).v === b1.players[0].score, 'игрок и баллы в бою 1');
const T = ss.getSheetByName('Тур 1 Таблица');
assert(T.frozen.join() === '1,2', 'закреплены шапка и имена');
assert(cell('Тур 1 Таблица', 2, 2).v === snapA.table[0].name && cell('Тур 1 Таблица', 32, 2).v === snapA.table[30].name, 'все 31 строка таблицы');
// цвет круга = цвет боя: у всех участников боя 1 в круге 1 один цвет, у разных боёв — разный
const colorOf = (name, t) => { const i = snapA.table.findIndex((x) => x.name === name); return cell('Тур 1 Таблица', i + 2, 3 + t).bg; };
const c1 = b1.players.map((p) => colorOf(p.name, 0));
assert(new Set(c1).size === 1 && c1[0], 'участники одного боя одного цвета');
const allC = snapA.rounds[0].battles.map((b) => colorOf(b.players[0].name, 0));
assert(new Set(allC).size === allC.length, 'бои круга разных цветов');
assert(T.borders.some((b) => b[0] === 4 && b[4] === 'bottom'), 'черта после 3-го места');
const O = 'Отбор Таблица';
assert(cell(O, 3, 12).v === 'Ф' && cell(O, 3, 1).v === 1, 'победитель тура первым с «Ф»: ' + JSON.stringify(cell(O, 3, 12)));
assert(cell(O, 4, 4).v === 25 && cell(O, 4, 11).v === 25, '2-е место — 25, сумма без худшего — 25 (остальные туры 0)');

// 3. Чужой турнир в тот же тур — отказ, с force — перезапись
const B = tournament(28, 'B');
r = post({ key: K, tour: 1, snap: SG.sheetSnapshot(B) });
assert(!r.ok && r.error === 'conflict' && r.other === 'Тест A', 'другой турнир в занятый тур: ' + JSON.stringify(r));
r = post({ key: K, tour: 1, force: true, snap: SG.sheetSnapshot(B) });
assert(r.ok, 'перезапись с force');
assert(!cell('Тур 1 Таблица', 30, 2).v && cell('Тур 1 Таблица', 31, 2).v === 'Финал тура', 'старые строки стёрты, финал сразу под таблицей');

// 4. Опоздавший старый снимок того же турнира не затирает свежий
const old = SG.sheetSnapshot(B); old.savedAt = 1;
r = post({ key: K, tour: 1, snap: old });
assert(r.ok && r.stale, 'старый снимок пропущен');

// 5. Идущий тур: круг 3 разыгран без баллов, без финала, без площадок
const C = tournament(34, 'C', { rounds: 3, lastEmpty: true, noVenues: true });
r = post({ key: K, tour: 2, snap: SG.sheetSnapshot(C) });
assert(r.ok, 'идущий тур без площадок');
assert(ss.getSheets().map((s) => s.name).slice(0, 5).join() === 'Тур 1 Бои,Тур 1 Таблица,Тур 2 Бои,Тур 2 Таблица,Отбор Таблица', 'листы тура 2 встали по порядку');
const snapC = SG.sheetSnapshot(C);
assert(snapC.played === 2 && !snapC.result, 'сыграно 2 круга, итога нет');
assert(cell('Тур 2 Таблица', 2, 5).v === '' && cell('Тур 2 Таблица', 2, 4).v, 'круг 3 в таблице пуст, круг 2 заполнен');
assert(ss.getSheetByName('Тур 2 Бои').tab === '#4a86e8', 'цвет ярлычка тура 2');

// 6. До первых результатов: таблица по стартовым номерам без мест
const D = tournament(30, 'D', { rounds: 1, lastEmpty: true });
r = post({ key: K, tour: 3, snap: SG.sheetSnapshot(D) });
assert(r.ok && cell('Тур 3 Таблица', 2, 1).v === '' && cell('Тур 3 Таблица', 2, 2).v === 'Игрок0 Тестов', 'до результатов — список по стартовым номерам');

// 7. Отбор: сумма без худшего, «Ф» отдельно, делёж мест
const reg = {
  1: { result: [{ name: 'А', place: '1', cup: 'Ф' }, { name: 'Б', place: '2', cup: 25 }, { name: 'В', place: '5–8', cup: 13.5 }, { name: 'Г', place: '20', cup: 0 }] },
  2: { result: [{ name: 'Б', place: '1', cup: 'Ф' }, { name: 'А', place: '4', cup: 17 }, { name: 'В', place: '2', cup: 25 }, { name: 'Г', place: '20', cup: 0 }] },
  3: { result: [{ name: 'В', place: '3', cup: 20 }, { name: 'А', place: '9', cup: 11 }, { name: 'Г', place: '21', cup: 0 }, { name: 'Д', place: '22', cup: 0 }] },
};
const rows = api.seasonRows_(reg);
const by = Object.fromEntries(rows.map((x) => [x.name, x]));
assert(by['А'].tot === 28 && by['А'].best === 'Ф', 'А: Ф, 17, 11, тур 4 не играл → 17 + 11 = 28');
assert(by['В'].tot === 58.5 && by['В'].best === 25, 'В: 13,5 + 25 + 20, худший — несыгранный тур');
assert(rows[0].name === 'А' && rows[1].name === 'Б', 'обладатели «Ф» первыми, между ними — по сумме');
assert(by['Г'].place === '4–5' && by['Д'].place === '4–5', 'равные делят место');

// 8. Статус (JSONP)
const s = get({ act: 'status', key: K, callback: 'cb1' });
assert(/^cb1\(/.test(s) && JSON.parse(s.slice(4, -1)).tours[1].name === 'Тест B', 'статус через callback');
assert(get({ act: 'status', key: K, callback: 'x);alert(1' }).startsWith('{'), 'callback только из безопасных символов');

// 9. 48 участников, 16 боёв в круге: всё помещается, ключ свойства < 9 КБ
const E = tournament(48, 'E');
r = post({ key: K, tour: 4, snap: SG.sheetSnapshot(E) });
assert(r.ok, '48 участников: ' + JSON.stringify(r));
// 10. Старый лист с помехой пересоздаётся на том же месте; неустранимая ошибка приходит текстом
const env2 = makeEnv();
const bad = env2.ss.insertSheet('Тур 1 Таблица', 0); bad.broken = true;
r = env2.post({ key: K, tour: 1, snap: SG.sheetSnapshot(A) });
assert(r.ok && env2.ss.getSheetByName('Тур 1 Таблица') !== bad && !env2.ss.getSheetByName('Временный'), 'лист с помехой пересоздан: ' + JSON.stringify(r));
assert(env2.ss.getSheets().map((x) => x.name).slice(0, 3).join() === 'Тур 1 Бои,Тур 1 Таблица,Отбор Таблица', 'на том же месте');
const env3 = makeEnv();
env3.ss.insertSheet = () => { throw new Error('нет прав'); };
r = env3.post({ key: K, tour: 1, snap: SG.sheetSnapshot(A) });
assert(!r.ok && r.error === 'exception' && /нет прав/.test(r.message), 'текст ошибки уходит в приложение: ' + JSON.stringify(r));
console.log('OK: заливка в Google Таблицу (имитация): листы, цвета боёв, защита от чужого турнира, Отбор без худшего, 48 участников');
