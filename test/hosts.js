// Проверка площадок и ведущих.
const SG = require('../src/engine.js');
const assert = (c, m) => { if (!c) { console.error('ОШИБКА:', m); process.exit(1); } };

// 1. Пример из постановки: 10 боёв, 5 площадок по 2 боя → на 1-й площадке бои 1 и 6
const plan = SG.venuePlan(10, { count: 5, perVenue: 2 });
const byVenue = (v) => plan.map((p, i) => (p.venue === v ? i + 1 : 0)).filter(Boolean);
assert(byVenue(0).join() === '1,6' && byVenue(1).join() === '2,7' && byVenue(4).join() === '5,10', 'раскладка 10/5');
assert(plan[5].slot === 2 && plan[0].slot === 1, 'порядок на площадке');
const chk = SG.venueCheck(11, { count: 5, perVenue: 2 });
assert(chk.over.join() === '0', 'перебор мест на 1-й площадке');
const chk2 = SG.venueCheck(10, { count: 6, perVenue: 2 });
assert(chk2.single.join() === '4,5', 'одиночные бои на площадках 5 и 6');

// 2. Ведущие: бой 1 ведёт кто-то из боя 6 и наоборот, выбирается тот, кто выше в списке
const mk = (n, size = 3) => Array.from({ length: n }, (_, i) => ({ players: Array.from({ length: size }, (_, j) => 'p' + (i * size + j)), scores: {} }));
let tour = { battles: mk(10) };
const hosts = ['p17', 'p16', 'p1', 'p0', 'p15']; // p15..p17 — бой 6, p0..p2 — бой 1
SG.placeTour(tour, { count: 5, perVenue: 2 }, hosts);
assert(tour.battles[0].host === 'p17', 'бой 1 ведёт лучший из боя 6: ' + tour.battles[0].host);
assert(tour.battles[5].host === 'p1', 'бой 6 ведёт лучший из боя 1: ' + tour.battles[5].host);
assert(tour.battles[1].host === null, 'на 2-й площадке нет ведущих из списка');

// 3. На площадке 3 боя: один человек не ведёт два боя
tour = { battles: mk(9) };
// площадка 0: бои 0, 3, 6. В списке только участники боя 3 (p9..p11)
SG.placeTour(tour, { count: 3, perVenue: 3 }, ['p9', 'p10', 'p20']);
const h = [0, 3, 6].map((i) => tour.battles[i].host);
assert(h[1] === 'p20', 'бой 4 ведёт p20 из боя 7');
assert(h[0] && h[2] && h[0] !== h[2] && ['p9', 'p10'].includes(h[0]) && ['p9', 'p10'].includes(h[2]), 'разные ведущие из боя 4: ' + h);
assert(h[0] === 'p9', 'лучший ведущий достаётся первому бою при равенстве: ' + h);

// 4. Ручное назначение сохраняется, недопустимое сбрасывается
tour.battles[0].host = 'p10'; tour.battles[0].hostManual = true;
SG.assignHosts(tour.battles, ['p9', 'p10', 'p20']);
assert(tour.battles[0].host === 'p10' && tour.battles[6].host === 'p9', 'ручной ведущий сохранён, второй пересчитан');
tour.battles[0].host = 'p1'; tour.battles[0].hostManual = true; // p1 играет в этом же бою
SG.assignHosts(tour.battles, ['p9', 'p10', 'p20']);
assert(tour.battles[0].host !== 'p1' && !tour.battles[0].hostManual, 'недопустимый ручной сброшен');

// 5. Финал
assert(SG.finalHost(['a', 'b', 'c'], ['b', 'x', 'a']) === 'x', 'ведущий финала');

// 6. Полный турнир: ведущий никогда не играет в своём бою и всегда с той же площадки
let bad = 0;
for (let N = 25; N <= 48; N++) {
  const st = { settings: { venues: { count: 5, perVenue: 2 } }, players: [], tours: [] };
  for (let i = 0; i < N; i++) st.players.push({ id: 'q' + i, name: 'Q' + i, rating: 1000 - i });
  const hl = st.players.filter((_, i) => i % 2 === 0).map((p) => p.id);
  for (let t = 0; t < 4; t++) {
    const d = SG.drawNext(st);
    const tr = SG.placeTour({ battles: d.battles }, st.settings.venues, hl);
    tr.battles.forEach((b, i) => {
      if (b.host && b.players.includes(b.host)) bad++;
      if (b.host && !tr.battles.some((o, j) => j !== i && o.venue === b.venue && o.players.includes(b.host))) bad++;
      b.players.forEach((id, k) => (b.scores[id] = (k * 37 + t * 11 + N) % 90));
    });
    const hostsUsed = tr.battles.map((b) => b.host).filter(Boolean);
    if (new Set(hostsUsed).size !== hostsUsed.length) bad++;
    st.tours.push(tr);
  }
}
assert(bad === 0, 'нарушений в полных турнирах: ' + bad);
console.log('OK: площадки и ведущие');
