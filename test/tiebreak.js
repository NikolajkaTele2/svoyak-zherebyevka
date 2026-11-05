// Дополнительные показатели: личная встреча перед каждым показателем, перестрелка за тройку,
// делёж мест с 4-го, отдых ведущих.
const SG = require('../src/engine.js');
const assert = (c, m) => { if (!c) { console.error('ОШИБКА:', m); process.exit(1); } };
const B = (players, scores) => ({ players, scores: Object.fromEntries(players.map((p, i) => [p, scores[i]])) });
const mkState = (ids, tours, settings) => ({ settings: settings || {}, players: ids.map((id, i) => ({ id, name: id.toUpperCase(), rating: 100 - i })), tours });

// 1. Двое равных встречались: выше тот, у кого больше баллов в общем бою, даже если сумма баллов меньше
let st = mkState(['a', 'b', 'c', 'd', 'e', 'f'], [
  { battles: [B(['a', 'b', 'c'], [100, 50, 0]), B(['d', 'e', 'f'], [100, 50, 0])] },
  { battles: [B(['c', 'd', 'a'], [50, 100, 0]), B(['e', 'b', 'f'], [300, 250, 0])] }, // a и b по 2 очка; у b сумма баллов больше
]);
let t = SG.standings(st);
const ia = t.findIndex((r) => r.id === 'a'), ib = t.findIndex((r) => r.id === 'b');
assert(t[ia].pts === t[ib].pts && ia < ib && t[ia].sep === 'h2h', 'личная встреча решает пару: ' + t.map((r) => r.id + r.pts + (r.sep || '')).join(' '));
t = SG.standings({ ...st, settings: { h2hEach: false } });
assert(t.findIndex((r) => r.id === 'b') < t.findIndex((r) => r.id === 'a'), 'выключенная личная встреча');

// 2. Свойства на случайных турнирах: каждый стык «решено по X» действительно решён X
let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let deepH2H = 0, sepsChecked = 0;
for (let k = 0; k < 150; k++) {
  const N = 25 + (k % 12);
  const S = { settings: { seed1: 'pots' }, players: [], tours: [] };
  for (let i = 0; i < N; i++) S.players.push({ id: 'p' + i, name: 'P' + i, rating: 1000 + Math.round(rnd() * 900) });
  for (let r = 0; r < 4; r++) {
    const d = SG.drawNext(S);
    d.battles.forEach((b) => b.players.forEach((id) => (b.scores[id] = Math.round(rnd() * 8 - 2) * 20)));
    S.tours.push({ battles: d.battles });
  }
  const T2 = SG.standings(S);
  for (let i = 0; i + 1 < T2.length; i++) {
    const a = T2[i], b = T2[i + 1];
    assert(a.pts >= b.pts - 1e-9, 'очки по убыванию');
    if (Math.abs(a.pts - b.pts) > 1e-9) { assert(!a.sep, 'нет пометки между разными очками'); continue; }
    sepsChecked++;
    assert(a.sep, 'между равными по очкам всегда указано, чем решено');
    if (a.sep === 'score') assert(a.score > b.score, 'баллы решают');
    if (a.sep === 'buch') assert(a.score === b.score && a.opp > b.opp, 'сила соперников решает при равных баллах');
    if (a.sep === 'h2h') {
      const groupSize = T2.filter((r) => Math.abs(r.pts - a.pts) < 1e-9).length;
      if (a.score === b.score && groupSize > 2) deepH2H++;
    }
  }
}
assert(deepH2H > 0, 'личная встреча срабатывает на глубоком шаге хотя бы иногда');

// 3. Полное равенство на границе тройки → перестрелка; с 4-го места → делят места и кубковые очки
const ids = ['a', 'b', 'c', 'd', 'x1', 'x2', 'y1', 'y2', 'z1', 'z2', 'w1', 'w2'];
st = mkState(ids, [{ battles: [B(['a', 'x1', 'x2'], [100, 50, 0]), B(['b', 'y1', 'y2'], [100, 50, 0]), B(['c', 'z1', 'z2'], [100, 50, 0]), B(['d', 'w1', 'w2'], [100, 50, 0])] }]);
t = SG.standings(st);
assert(t.shootout && t.shootout.ids.length === 4 && t.shootout.from === 1 && t.shootout.to === 4, 'нужна перестрелка за выход в тройку');
assert(t.slice(4, 8).every((r) => r.place === '5–8') && t[4].sep === 'shared', 'места 5–8 делятся');
st.shootouts = { [SG.groupKey(['a', 'b', 'c', 'd'])]: ['d', 'c', 'b', 'a'] };
t = SG.standings(st);
assert(!t.shootout && t.slice(0, 4).map((r) => r.id).join('') === 'dcba' && t[0].sep === 'shoot', 'порядок из перестрелки');
assert(t[3].place === '4', 'проигравший перестрелку — 4-й');
st.final = { players: ['d', 'c', 'b'], scores: { d: 300, c: 200, b: 100 } };
const f = SG.finalStandings(st);
assert(f.rows[3].id === 'a' && f.rows[3].cup === 17, '4-е место — 17 очков');
assert(f.rows.slice(4, 8).every((r) => r.place === '5–8' && r.cup === 13.5), 'делёж 5–8: (15+14+13+12)/4 = 13,5');
assert(f.rows.slice(8).every((r) => r.place === '9–12' && r.cup === 9.5), 'делёж 9–12: (11+10+9+8)/4 = 9,5');

// 4. Пятеро равных за тройку: после перестрелки двое оставшихся делят 4–5 место
const ids5 = ['a', 'b', 'c', 'd', 'e', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];
st = mkState(ids5, [{ battles: ['a', 'b', 'c', 'd', 'e'].map((x, i) => B([x, 'q' + (2 * i + 1), 'q' + (2 * i + 2)], [100, 50, 0])) }]);
st.shootouts = { [SG.groupKey(['a', 'b', 'c', 'd', 'e'])]: ['e', 'd', 'c', 'b', 'a'] };
t = SG.standings(st);
assert(t[3].place === '4–5' && t[4].place === '4–5', 'не попавшие в тройку после перестрелки делят места');

// 5. Порядок показателей: старые настройки
assert(SG.tbOrder({ settings: { tiebreaks: ['h2h', 'buch', 'score'] } }).join() === 'buch,score', 'h2h убирается из списка');
assert(SG.tbOrder({ settings: { tiebreaks: ['rating', 'score', 'buch'] } }).join() === 'score,buch', 'rating убирается');
assert(SG.tbOrder({ settings: {} }).join() === 'score,buch', 'по умолчанию: баллы, сила соперников');

// Ведущие: кто вёл в двух предыдущих турах подряд, в следующем туре не назначается
const T = (hosts) => ({ battles: hosts.map((h) => ({ players: [], host: h })) });
let bl = SG.hostBlocked([T(['x', 'y']), T(['x', 'z'])], 2);
assert(bl.has('x') && !bl.has('y') && !bl.has('z'), 'x вёл туры 1 и 2 — отдыхает в 3');
bl = SG.hostBlocked([T(['x']), T(['x']), T(['y'])], 3);
assert(!bl.has('x'), 'x пропустил тур 3 — в туре 4 снова может вести');
assert(SG.finalHost(['a'], ['x', 'y'], new Set(['x'])) === 'y', 'финал: пропуск отдыхающего ведущего');
bl = SG.hostBlocked([T(['x', 'y']), T(['z'])], 2, 1);
assert(bl.has('z') && !bl.has('x') && bl.size === 1, 'отдых после одного тура: блокируется только ведущий прошлого тура');
bl = SG.hostBlocked([T(['x'])], 1, 1);
assert(bl.has('x'), 'отдых после одного тура: x вёл тур 1 — в туре 2 отдыхает');

// Полные турниры: никто не ведёт три тура подряд, ведущих по-прежнему много
let violations = 0, hosted = 0, total = 0;
for (let N = 25; N <= 48; N++) {
  const s = { settings: { venues: { count: 5, perVenue: 2 } }, players: [], tours: [] };
  for (let i = 0; i < N; i++) s.players.push({ id: 'q' + i, name: 'Q' + i, rating: 1000 - i });
  const hl = s.players.map((p) => p.id); // все в списке ведущих
  for (let t = 0; t < 4; t++) {
    const d = SG.drawNext(s);
    const tr = SG.placeTour({ battles: d.battles }, s.settings.venues, hl, SG.hostBlocked(s.tours, t), 'venue');
    tr.battles.forEach((b) => { b.players.forEach((id, k) => (b.scores[id] = (k * 37 + t * 11 + N) % 90)); total++; if (b.host) hosted++; });
    s.tours.push(tr);
  }
  for (let t = 2; t < 4; t++) {
    const h = (k) => new Set(s.tours[k].battles.map((b) => b.host).filter(Boolean));
    for (const id of h(t)) if (h(t - 1).has(id) && h(t - 2).has(id)) violations++;
  }
}
assert(violations === 0, 'три тура подряд: ' + violations);
let v1 = 0, h1 = 0, tot1 = 0;
for (let N = 25; N <= 48; N++) {
  const s1 = { settings: { venues: { count: 5, perVenue: 2, order: 'pairs' } }, players: [], tours: [] };
  for (let i = 0; i < N; i++) s1.players.push({ id: 'q' + i, name: 'Q' + i, rating: 1000 - i });
  const hl = s1.players.map((p) => p.id);
  for (let t = 0; t < 4; t++) {
    const d = SG.drawNext(s1);
    const tr = SG.placeTour({ battles: d.battles }, s1.settings.venues, hl, SG.hostBlocked(s1.tours, t, 1), 'all');
    tr.battles.forEach((b) => { b.players.forEach((id, k) => (b.scores[id] = (k * 37 + t * 11 + N) % 90)); tot1++; if (b.host) h1++; });
    s1.tours.push(tr);
  }
  for (let t = 1; t < 4; t++) {
    const h = (k) => new Set(s1.tours[k].battles.map((b) => b.host).filter(Boolean));
    for (const id of h(t)) if (h(t - 1).has(id)) v1++;
  }
}
assert(v1 === 0, 'отдых после одного тура: вели два тура подряд ' + v1);
// Правило «не больше 4 игр подряд» (играет или ведёт): ни у кого нет 5 занятых волн подряд
let runViol = 0, hostedS = 0, totalS = 0;
for (let N = 25; N <= 40; N++) for (const scope of ['all', 'venue']) {
  const s2 = { settings: { venues: { count: 5, perVenue: 2, order: 'hosts' } }, players: [], tours: [] };
  for (let i = 0; i < N; i++) s2.players.push({ id: 'q' + i, name: 'Q' + i, rating: 1000 - i });
  const hl = s2.players.map((p) => p.id);
  const busy = {}; let len = 0;
  for (let t = 0; t < 4; t++) {
    const d = SG.drawNext(s2);
    const tr = SG.placeTour({ battles: d.battles }, s2.settings.venues, hl, SG.hostBlocked(s2.tours, t, 'slots'), scope);
    const W = Math.max(...tr.battles.map((b) => b.slot));
    tr.battles.forEach((b) => {
      const sl = len + b.slot - 1;
      [...b.players, b.host].filter(Boolean).forEach((id) => { (busy[id] = busy[id] || new Set()).add(sl); });
      b.players.forEach((id, k) => (b.scores[id] = (k * 37 + t * 11 + N) % 90)); totalS++; if (b.host) hostedS++;
    });
    len += W; s2.tours.push(tr);
  }
  for (const id in busy) { let r = 0; for (let x = 0; x < len; x++) { r = busy[id].has(x) ? r + 1 : 0; if (r >= 5) { runViol++; break; } } }
}
assert(runViol === 0, '5 занятых волн подряд: ' + runViol);
assert(hostedS / totalS > 0.85, 'с правилом волн ведущих достаточно: ' + hostedS + ' из ' + totalS);
const brule = SG.hostBlocked([{ battles: [{ players: ['a', 'b', 'c'], slot: 1, host: null }, { players: ['d', 'e', 'f'], slot: 2, host: 'a' }] }], 1, 'slots');
assert(!brule.has('a'), 'финал не считается');
assert(brule.forBattles([{ players: ['a', 'x', 'y'], slot: 1 }, { players: ['z', 'w', 'v'], slot: 2 }]).has('a', 2), 'a: играл 1, вёл 2, играет 1, ведёт 2 → 4 + запас = 5 — нельзя');
assert(brule.forBattles([{ players: ['z', 'x', 'y'], slot: 1 }, { players: ['a', 'w', 'v'], slot: 2 }]).has('a', 1), 'a: играл 1, вёл 2, ведёт 1, играет 2 → 4 и запас — нельзя');
const brule2 = SG.hostBlocked([{ battles: [{ players: ['d', 'e', 'f'], slot: 1, host: null }, { players: ['a', 'b', 'c'], slot: 2, host: null }] }], 1, 'slots');
assert(!brule2.forBattles([{ players: ['z', 'x', 'y'], slot: 1 }, { players: ['a', 'w', 'v'], slot: 2 }]).has('a', 1), 'a: играл 2, ведёт 1, играет 2 → 3 и запас = 4 — можно');
console.log('OK: не больше 4 игр подряд (с ведущим ' + hostedS + ' из ' + totalS + '); отдых после одного тура (с ведущим ' + h1 + ' из ' + tot1 + '); личная встреча на каждом шаге (стыков: ' + sepsChecked + ', глубоких срабатываний: ' + deepH2H + '), перестрелка, делёж мест, отдых ведущих (с ведущим ' + hosted + ' из ' + total + ')');
