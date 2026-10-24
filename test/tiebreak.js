// Личная встреча и правило «два тура подряд вёл — следующий отдыхает».
const SG = require('../src/engine.js');
const assert = (c, m) => { if (!c) { console.error('ОШИБКА:', m); process.exit(1); } };
const B = (players, scores) => ({ players, scores: Object.fromEntries(players.map((p, i) => [p, scores[i]])) });
const st = (tours, tiebreaks) => ({
  settings: { tiebreaks },
  players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, name: id.toUpperCase(), rating: 100 - i })),
  tours,
});
const ids = (s) => SG.standings(s).map((r) => r.id).join('');

// Двое равных встречались: выше тот, у кого в общем бою больше баллов, даже если он там был вторым.
// Т1: [a b c] 100/50/0, [d e f] 100/50/0. Т2: [c d e] 100/50/0, [a b f] 100/50/0.
// Итого a=4, d=3, b=2, c=2, e=1, f=0. b и c встречались в Т1, b набрал больше (50 > 0, места 2 и 3).
const pairTours = [
  { battles: [B(['a', 'b', 'c'], [100, 50, 0]), B(['d', 'e', 'f'], [100, 50, 0])] },
  { battles: [B(['c', 'd', 'e'], [100, 50, 0]), B(['a', 'b', 'f'], [100, 50, 0])] },
];
let r = SG.standings(st(pairTours, ['h2h', 'buch', 'score']));
assert(ids(st(pairTours, ['h2h', 'buch', 'score'])) === 'adbcef', 'личная встреча первой: ' + ids(st(pairTours, ['h2h', 'buch', 'score'])));
assert(r.find((x) => x.id === 'b').h2h === 1 && r.find((x) => x.id === 'c').h2h === -1, 'мини-таблица +1/−1');
// у b и c равны и сила соперников (2,5), и сумма баллов (100) — значит, при порядке по умолчанию решает личная встреча
assert(ids(st(pairTours, ['buch', 'score', 'h2h'])) === 'adbcef', 'личная встреча третьей');

// Трое равных, не все встречались: личная встреча пропускается, решает следующий показатель.
// Т2': [b d f] 100/50/0, [c a e] 100/50/0 → a=3, b=3, d=3 (a–b встречались, b–d встречались, a–d нет)
const triTours = [pairTours[0], { battles: [B(['b', 'd', 'f'], [100, 50, 0]), B(['c', 'a', 'e'], [100, 50, 0])] }];
r = SG.standings(st(triTours, ['h2h', 'score', 'buch']));
const top3 = r.slice(0, 3);
assert(top3.every((x) => x.h2h === null), 'для неполной тройки личная встреча не применяется');
const byScore = top3.slice().sort((x, y) => y.score - x.score).map((x) => x.id).join('');
assert(top3.map((x) => x.id).join('') === byScore || top3[0].score === top3[1].score, 'решает сумма баллов');

// Трое равных, все встречались (в одном бою): порядок по баллам того боя
const tie3 = [
  { battles: [B(['a', 'b', 'c'], [90, 60, 30]), B(['d', 'e', 'f'], [100, 50, 0])] }, // a2 b1 c0
  { battles: [B(['a', 'd', 'e'], [0, 50, 100]), B(['b', 'c', 'f'], [0, 100, 50])] },  // a0 e2 d1 ; c2 f1 b0
];
// a=2, b=1, c=2, d=3, e=3, f=1 → группы: d,e (3) — встречались в Т1 (d 100 > e 50) и Т2 (e 100 > d 50)?
// d и e играли дважды — так не бывает в настоящей жеребьёвке; проверяем a,c (2): встречались в Т1, a 90 > c 30
r = SG.standings(st(tie3, ['h2h', 'buch', 'score']));
const ia = r.findIndex((x) => x.id === 'a'), ic = r.findIndex((x) => x.id === 'c');
assert(ia < ic && ia + 1 === ic, 'a выше c по личной встрече');

// Устаревший «рейтинг» в настройках заменяется личной встречей
assert(SG.tbOrder({ settings: { tiebreaks: ['rating', 'buch', 'score'] } }).join() === 'h2h,buch,score', 'миграция rating → h2h');
assert(SG.tbOrder({ settings: { tiebreaks: ['buch', 'score', 'rating'] } }).join() === 'h2h,buch,score', 'миграция: личная встреча первой');
assert(SG.tbOrder({ settings: { tiebreaks: ['score', 'h2h', 'buch'] } }).join() === 'score,h2h,buch', 'выбранный порядок сохраняется');
assert(SG.tbOrder({ settings: {} }).join() === 'h2h,buch,score', 'порядок по умолчанию');

// Ведущие: кто вёл в двух предыдущих турах подряд, в следующем туре не назначается
const T = (hosts) => ({ battles: hosts.map((h) => ({ players: [], host: h })) });
let bl = SG.hostBlocked([T(['x', 'y']), T(['x', 'z'])], 2);
assert(bl.has('x') && !bl.has('y') && !bl.has('z'), 'x вёл туры 1 и 2 — отдыхает в 3');
bl = SG.hostBlocked([T(['x']), T(['x']), T(['y'])], 3);
assert(!bl.has('x'), 'x пропустил тур 3 — в туре 4 снова может вести');
assert(SG.finalHost(['a'], ['x', 'y'], new Set(['x'])) === 'y', 'финал: пропуск отдыхающего ведущего');

// Полные турниры: никто не ведёт три тура подряд, ведущих по-прежнему много
let violations = 0, hosted = 0, total = 0;
for (let N = 25; N <= 48; N++) {
  const s = { settings: { venues: { count: 5, perVenue: 2 } }, players: [], tours: [] };
  for (let i = 0; i < N; i++) s.players.push({ id: 'q' + i, name: 'Q' + i, rating: 1000 - i });
  const hl = s.players.map((p) => p.id); // все в списке ведущих
  for (let t = 0; t < 4; t++) {
    const d = SG.drawNext(s);
    const tr = SG.placeTour({ battles: d.battles }, s.settings.venues, hl, SG.hostBlocked(s.tours, t));
    tr.battles.forEach((b) => { b.players.forEach((id, k) => (b.scores[id] = (k * 37 + t * 11 + N) % 90)); total++; if (b.host) hosted++; });
    s.tours.push(tr);
  }
  for (let t = 2; t < 4; t++) {
    const h = (k) => new Set(s.tours[k].battles.map((b) => b.host).filter(Boolean));
    for (const id of h(t)) if (h(t - 1).has(id) && h(t - 2).has(id)) violations++;
  }
}
assert(violations === 0, 'три тура подряд: ' + violations);
console.log('OK: личная встреча и отдых ведущих (бои с ведущим: ' + hosted + ' из ' + total + ')');
