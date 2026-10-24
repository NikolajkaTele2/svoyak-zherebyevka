// Кубковые очки и итоговая таблица.
const SG = require('../src/engine.js');
const assert = (c, m) => { if (!c) { console.error('ОШИБКА:', m); process.exit(1); } };
const expect = { 1: 'Ф', 2: 25, 3: 20, 4: 17, 5: 15, 6: 14, 7: 13, 8: 12, 9: 11, 10: 10, 11: 9, 12: 8, 13: 7, 14: 6, 15: 5, 16: 4, 17: 3, 18: 2, 19: 1, 20: 0, 33: 0 };
for (const [p, v] of Object.entries(expect)) assert(SG.cupForPlace(Number(p)) === v, 'место ' + p + ': ' + SG.cupForPlace(Number(p)));
assert(SG.cupPoints(5, 6) === 14.5 && SG.cupPoints(11, 12) === 8.5, 'деление мест как в таблице организатора (14,5 и 8,5)');
assert(SG.cupPoints(2, 3) === 22.5, 'финал: 2–3 место');
assert(SG.cupPoints(1, 2) === null, 'ничья за первое место — без очков');

// полный турнир
const st = { settings: {}, players: [], tours: [] };
for (let i = 0; i < 30; i++) st.players.push({ id: 'p' + i, name: 'P' + i, rating: 1000 - i });
for (let t = 0; t < 4; t++) {
  const d = SG.drawNext(st);
  d.battles.forEach((b) => b.players.forEach((id, k) => (b.scores[id] = (k * 41 + t * 7 + Number(id.slice(1))) % 100)));
  st.tours.push({ battles: d.battles });
}
const top = SG.standings(st, 4).slice(0, 3).map((r) => r.id);
st.final = { players: top, scores: { [top[0]]: 100, [top[1]]: 300, [top[2]]: 200 } };
let f = SG.finalStandings(st);
assert(f.rows.length === 30 && f.played, 'все участники в итоге');
assert(f.rows[0].id === top[1] && f.rows[0].cup === 'Ф' && f.rows[1].cup === 25 && f.rows[2].cup === 20, 'места 1–3 по финалу');
assert(f.rows[3].place === '4' && f.rows[3].cup === 17 && f.rows[19].cup === 0 && f.rows[18].cup === 1, 'места 4+ по отбору');
st.final.scores[top[2]] = 300; // ничья за первое место
f = SG.finalStandings(st);
assert(f.tieForFirst && f.rows[0].cup === null && f.rows[2].cup === 20, 'ничья за 1-е: предупреждение');
st.final.scores = { [top[0]]: 300, [top[1]]: 100, [top[2]]: 100 };
f = SG.finalStandings(st);
assert(!f.tieForFirst && f.rows[1].cup === 22.5 && f.rows[2].cup === 22.5 && f.rows[1].place === '2–3', 'делят 2–3: по 22,5');
console.log('OK: кубковые очки');
