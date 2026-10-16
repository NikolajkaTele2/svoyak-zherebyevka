/* Своя игра — швейцарская жеребьёвка. Ядро без DOM. */
const SG = (() => {
  const QUAL_TOURS = 4;
  const PTS = { 3: [2, 1, 0], 4: [2, 1, 0.5, 0] };

  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  /* Размеры боёв: максимум по 3, бои по 4 — только чтобы закрыть остаток (b = N mod 3).
     even = true: если боёв нечётное число, 4 боя по 3 заменяются на 3 боя по 4 (боёв становится на один меньше). */
  function battleSizes(n, even) {
    if (n === 3 || n === 4) return [n];
    let b = n % 3;
    let a = (n - 4 * b) / 3;
    if (n < 6 || a < 0) return null;
    if (even && (a + b) % 2 === 1 && a >= 4) {
      a -= 4;
      b += 3;
    }
    return Array(a).fill(3).concat(Array(b).fill(4)); // сверху вниз: тройки у лидеров, четвёрки внизу
  }
  const sizesFor = (state, n) => battleSizes(n, !!(state.settings && state.settings.evenBattles));

  /* Места и очки одного боя с делёжкой. null, если не все баллы введены. */
  function battleResult(battle) {
    const ids = battle.players;
    const table = PTS[ids.length];
    if (!table) return null;
    for (const id of ids) {
      const s = battle.scores[id];
      if (s === null || s === undefined || s === '' || !Number.isFinite(Number(s))) return null;
    }
    const sorted = ids.slice().sort((x, y) => Number(battle.scores[y]) - Number(battle.scores[x]));
    const res = {};
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      const v = Number(battle.scores[sorted[i]]);
      while (j + 1 < sorted.length && Number(battle.scores[sorted[j + 1]]) === v) j++;
      let sum = 0;
      for (let k = i; k <= j; k++) sum += table[k];
      const pts = sum / (j - i + 1);
      const place = i === j ? String(i + 1) : i + 1 + '–' + (j + 1);
      for (let k = i; k <= j; k++) res[sorted[k]] = { place, pts };
      i = j + 1;
    }
    return res;
  }

  function tourComplete(tour) {
    return tour.battles.every((b) => battleResult(b) !== null);
  }

  function metPairs(state, uptoTour = state.tours.length) {
    const met = new Set();
    state.tours.slice(0, uptoTour).forEach((t) =>
      t.battles.forEach((b) => {
        for (let i = 0; i < b.players.length; i++)
          for (let j = i + 1; j < b.players.length; j++) met.add(pairKey(b.players[i], b.players[j]));
      })
    );
    return met;
  }

  /* Турнирная таблица по завершённым турам (первые `upto`). */
  const TB = {
    buch: { label: 'Сила соперников', short: 'Сила соп.', get: (r) => r.opp },
    score: { label: 'Сумма баллов', short: 'Баллы', get: (r) => r.score },
    rating: { label: 'Рейтинг', short: 'Рейтинг', get: (r) => r.rating },
  };

  function standings(state, upto) {
    const tours = state.tours.slice(0, upto ?? state.tours.length);
    const rows = {};
    state.players.forEach((p) => {
      rows[p.id] = { id: p.id, name: p.name, rating: Number(p.rating) || 0, pts: 0, score: 0, opps: [], perTour: [], opp: 0 };
    });
    tours.forEach((t, ti) =>
      tourComplete(t) && t.battles.forEach((b, bi) => {
        const r = battleResult(b);
        b.players.forEach((id) => {
          const row = rows[id];
          if (!row) return;
          row.pts += r[id].pts;
          row.score += Number(b.scores[id]);
          row.perTour[ti] = { battle: bi + 1, pts: r[id].pts, place: r[id].place, score: Number(b.scores[id]), size: b.players.length, opps: b.players.filter((o) => o !== id) };
          b.players.forEach((o) => o !== id && row.opps.push(o));
        });
      })
    );
    Object.values(rows).forEach((row) => {
      row.opp = row.opps.length ? row.opps.reduce((s, o) => s + rows[o].pts, 0) / row.opps.length : 0;
    });
    const order = (state.settings && state.settings.tiebreaks) || ['buch', 'score', 'rating'];
    const list = Object.values(rows).sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      for (const k of order) {
        const d = TB[k].get(b) - TB[k].get(a);
        if (Math.abs(d) > 1e-9) return d;
      }
      return a.name.localeCompare(b.name, 'ru');
    });
    // места с учётом полного совпадения всех показателей
    list.forEach((row, i) => {
      row.rank = i + 1;
    });
    return list;
  }

  /* Тур 1: посев по рейтингу. */
  function drawFirst(state) {
    const ps = state.players.slice().sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) || a.name.localeCompare(b.name, 'ru'));
    const sizes = sizesFor(state, ps.length);
    if (!sizes) throw new Error('Нельзя разбить ' + ps.length + ' участников на бои по 3–4 человека.');
    const M = sizes.length;
    const battles = sizes.map(() => []);
    if ((state.settings && state.settings.seed1) === 'sequential') {
      let k = 0;
      sizes.forEach((s, i) => {
        for (let j = 0; j < s; j++) battles[i].push(ps[k++].id);
      });
    } else {
      // корзины змейкой: 1-я корзина — сильнейшие M, 2-я — следующие M (в обратном порядке), 3-я — прямо,
      // остаток (самые низкие рейтинги) добавляется в последние бои, делая их боями на 4.
      let k = 0;
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < M; i++) {
          const target = row % 2 === 0 ? i : M - 1 - i;
          battles[target].push(ps[k++].id);
        }
      }
      for (let i = M - (ps.length - k); i < M; i++) battles[i].push(ps[k++].id);
    }
    return { battles: battles.map((players) => ({ players, scores: Object.fromEntries(players.map((id) => [id, null])) })) };
  }

  /* Туры 2–4: швейцарская жеребьёвка сверху вниз с перебором и откатом. */
  function drawSwiss(state) {
    const st = standings(state);
    const ids = st.map((r) => r.id);
    const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
    const pts = Object.fromEntries(st.map((r) => [r.id, r.pts]));
    const met = metPairs(state);
    const sizes = sizesFor(state, ids.length);
    if (!sizes) throw new Error('Нельзя разбить участников на бои по 3–4 человека.');
    const M = sizes.length;

    const battleCost = (members, anchor, allowRepeat) => {
      let c = 0;
      for (let i = 0; i < members.length; i++) {
        c += idx[members[i]] - idx[anchor];
        for (let j = i + 1; j < members.length; j++) {
          const d = pts[members[i]] - pts[members[j]];
          c += d * d * 1000;
          if (allowRepeat && met.has(pairKey(members[i], members[j]))) c += 1e7;
        }
      }
      return c;
    };

    function attempt(window, maxNodes, allowRepeat) {
      let nodes = 0;
      function dfs(k, remaining) {
        if (k === M) return [];
        const anchor = remaining[0];
        const need = sizes[k] - 1;
        let cand = remaining.slice(1);
        if (!allowRepeat) cand = cand.filter((p) => !met.has(pairKey(anchor, p)));
        cand = cand.slice(0, window);
        const combos = [];
        const pick = [];
        (function rec(start) {
          if (pick.length === need) {
            combos.push(pick.slice());
            return;
          }
          for (let i = start; i <= cand.length - (need - pick.length); i++) {
            const p = cand[i];
            if (!allowRepeat && pick.some((q) => met.has(pairKey(p, q)))) continue;
            pick.push(p);
            rec(i + 1);
            pick.pop();
          }
        })(0);
        const scored = combos.map((c) => ({ c, cost: battleCost([anchor, ...c], anchor, allowRepeat) })).sort((a, b) => a.cost - b.cost);
        for (const { c } of scored) {
          if (++nodes > maxNodes) return undefined;
          const used = new Set([anchor, ...c]);
          const sub = dfs(k + 1, remaining.filter((p) => !used.has(p)));
          if (sub === undefined) return undefined;
          if (sub) return [[anchor, ...c], ...sub];
          if (allowRepeat) return null;
        }
        return null;
      }
      return dfs(0, ids);
    }

    let result = null;
    for (const [w, n] of [[12, 4000], [20, 40000], [ids.length, 400000]]) {
      result = attempt(w, n, false);
      if (result) break;
    }
    let repeats = 0;
    if (!result) {
      result = attempt(ids.length, 1e6, true);
      result.forEach((b) => {
        for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (met.has(pairKey(b[i], b[j]))) repeats++;
      });
    }
    return {
      repeats,
      battles: result.map((players) => {
        const sorted = players.slice().sort((a, b) => idx[a] - idx[b]);
        return { players: sorted, scores: Object.fromEntries(sorted.map((id) => [id, null])) };
      }),
    };
  }

  function drawNext(state) {
    if (state.tours.length === 0) return { repeats: 0, ...drawFirst(state) };
    return drawSwiss(state);
  }

  /* Повторные встречи внутри тура t относительно предыдущих туров. */
  function repeatsInTour(state, t) {
    const met = metPairs(state, t);
    const out = [];
    state.tours[t].battles.forEach((b, bi) => {
      for (let i = 0; i < b.players.length; i++)
        for (let j = i + 1; j < b.players.length; j++)
          if (met.has(pairKey(b.players[i], b.players[j]))) out.push({ battle: bi, a: b.players[i], b: b.players[j] });
    });
    return out;
  }

  const fmt = (x) => (Math.round(x * 100) / 100).toString().replace('.', ',');

  return { QUAL_TOURS, PTS, battleSizes, sizesFor, battleResult, tourComplete, metPairs, standings, drawFirst, drawSwiss, drawNext, repeatsInTour, fmt, pairKey, TB };
})();
if (typeof module !== 'undefined') module.exports = SG;
