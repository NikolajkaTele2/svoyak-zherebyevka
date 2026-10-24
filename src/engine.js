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
  /* Дополнительные показатели. h2h — личная встреча: считается внутри группы равных, поэтому get только для показа. */
  const TB = {
    buch: { label: 'Сила соперников', short: 'Сила соп.', get: (r) => r.opp },
    score: { label: 'Сумма баллов', short: 'Баллы', get: (r) => r.score },
    h2h: { label: 'Личная встреча', short: 'Личн.', group: true, get: (r) => r.h2h },
  };
  const TB_DEFAULT = ['h2h', 'buch', 'score'];
  /* Порядок показателей из настроек; устаревший «рейтинг» заменяется личной встречей. */
  function tbOrder(state) {
    let raw = (state.settings && state.settings.tiebreaks) || TB_DEFAULT;
    // турниры из старых версий: «рейтинг» убран, личная встреча ставится первой (последней она почти никогда не срабатывает)
    if (raw.includes('rating')) raw = ['h2h'].concat(raw.filter((k) => k !== 'rating'));
    const out = [];
    raw.forEach((k) => { if (TB[k] && !out.includes(k)) out.push(k); });
    TB_DEFAULT.forEach((k) => { if (!out.includes(k)) out.push(k); });
    return out.slice(0, 3);
  }

  /* Личная встреча внутри группы равных.
     Двое: применяется, если они играли в одном бою. Трое и больше: только если каждый играл с каждым.
     Мини-таблица: +1 за каждого из группы, у кого в общем бою больше баллов, −1 — у кого меньше. */
  function headToHead(group, met) {
    if (group.length < 2) return null;
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        if (!met.has(pairKey(group[i].id, group[j].id))) return null;
    const score = new Map(group.map((r) => [r.id, 0]));
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const m = met.get(pairKey(group[i].id, group[j].id));
        const a = m[group[i].id], b = m[group[j].id];
        if (a > b) { score.set(group[i].id, score.get(group[i].id) + 1); score.set(group[j].id, score.get(group[j].id) - 1); }
        else if (b > a) { score.set(group[j].id, score.get(group[j].id) + 1); score.set(group[i].id, score.get(group[i].id) - 1); }
      }
    return score;
  }

  function standings(state, upto) {
    const tours = state.tours.slice(0, upto ?? state.tours.length);
    const rows = {};
    const met = new Map(); // пара → баллы обоих в их общем бою
    state.players.forEach((p) => {
      rows[p.id] = { id: p.id, name: p.name, rating: Number(p.rating) || 0, pts: 0, score: 0, opps: [], perTour: [], opp: 0, h2h: null };
    });
    tours.forEach((t, ti) =>
      tourComplete(t) && t.battles.forEach((b, bi) => {
        const r = battleResult(b);
        for (let i = 0; i < b.players.length; i++)
          for (let j = i + 1; j < b.players.length; j++) {
            const x = b.players[i], y = b.players[j];
            met.set(pairKey(x, y), { [x]: Number(b.scores[x]), [y]: Number(b.scores[y]) });
          }
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
    const order = tbOrder(state);
    const eq = (a, b) => Math.abs(a - b) < 1e-9;
    // разбить отсортированный по убыванию key массив на группы равных
    const split = (arr, key) => {
      const out = [];
      arr.forEach((r) => { const last = out[out.length - 1]; if (last && eq(key(last[0]), key(r))) last.push(r); else out.push([r]); });
      return out;
    };
    // Группа равных по очкам упорядочивается показателями по очереди; последний запасной вариант —
    // исходный рейтинг, затем имя (чтобы порядок всегда был определён).
    function rankGroup(group, k) {
      if (group.length < 2) return group;
      if (k >= order.length) return group.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'ru'));
      const key = order[k];
      let key2;
      if (TB[key].group) {
        const s = headToHead(group, met);
        if (!s) return rankGroup(group, k + 1);
        group.forEach((r) => { r.h2h = s.get(r.id); });
        key2 = (r) => s.get(r.id);
      } else key2 = TB[key].get;
      const sorted = group.slice().sort((a, b) => key2(b) - key2(a));
      return split(sorted, key2).flatMap((g) => rankGroup(g, k + 1));
    }
    const byPts = Object.values(rows).sort((a, b) => b.pts - a.pts);
    const list = split(byPts, (r) => r.pts).flatMap((g) => rankGroup(g, 0));
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

  /* ---------- Площадки и ведущие ---------- */

  /* Бои раздаются по площадкам по кругу: при 5 площадках бои 1 и 6 — на 1-й, 2 и 7 — на 2-й и т. д.
     slot — какой по счёту этот бой на своей площадке. */
  function venuePlan(m, cfg) {
    const V = cfg && cfg.count ? Math.max(1, Math.min(10, cfg.count | 0)) : 0;
    if (!V) return null;
    return Array.from({ length: m }, (_, i) => ({ venue: i % V, slot: Math.floor(i / V) + 1 }));
  }

  /* Сводка по раскладке: сколько мест, где лишние бои, где бой один (некому вести). */
  function venueCheck(m, cfg) {
    const plan = venuePlan(m, cfg);
    if (!plan) return null;
    const V = cfg.count, K = cfg.perVenue || 1;
    const per = Array(V).fill(0);
    plan.forEach((p) => per[p.venue]++);
    return { V, K, slots: V * K, battles: m, per, over: per.map((n, i) => (n > K ? i : -1)).filter((i) => i >= 0), single: per.map((n, i) => (n === 1 ? i : -1)).filter((i) => i >= 0), empty: per.map((n, i) => (n === 0 ? i : -1)).filter((i) => i >= 0) };
  }

  function venueGroups(battles) {
    const g = new Map();
    battles.forEach((b, i) => {
      if (b.venue === null || b.venue === undefined) return;
      if (!g.has(b.venue)) g.set(b.venue, []);
      g.get(b.venue).push(i);
    });
    for (const idxs of g.values()) idxs.sort((x, y) => (battles[x].slot || 0) - (battles[y].slot || 0) || x - y);
    return g;
  }

  /* Кто может вести бой bi: участники других боёв той же площадки в этом туре. */
  /* Кто вёл бои в двух предыдущих турах подряд — в туре t автоматически не назначается. */
  function hostBlocked(tours, t) {
    const hosted = (k) => new Set(k >= 0 && tours[k] ? tours[k].battles.map((b) => b.host).filter(Boolean) : []);
    const a = hosted(t - 1), b = hosted(t - 2);
    return new Set([...a].filter((id) => b.has(id)));
  }

  function hostCandidates(battles, bi, hostIds, blocked) {
    blocked = blocked || new Set();
    const b = battles[bi];
    const rank = new Map((hostIds || []).map((id, i) => [id, i]));
    const out = [];
    if (!b || b.venue === null || b.venue === undefined) return out;
    battles.forEach((o, oi) => {
      if (oi === bi || o.venue !== b.venue) return;
      o.players.forEach((id) => out.push({ id, battle: oi, rank: rank.has(id) ? rank.get(id) : null, blocked: blocked.has(id) }));
    });
    return out.sort((a, c) => (a.blocked - c.blocked) || (a.rank === null ? 1e9 : a.rank) - (c.rank === null ? 1e9 : c.rank) || a.battle - c.battle);
  }

  const lessKey = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

  /* Назначить ведущих. На каждой площадке: один человек ведёт не больше одного боя за тур;
     сначала стараемся закрыть ведущими все бои, затем берём тех, кто выше в списке ведущих.
     Назначенные вручную (hostManual) сохраняются, если всё ещё допустимы. */
  function assignHosts(battles, hostIds, blocked) {
    blocked = blocked || new Set();
    const rank = new Map((hostIds || []).map((id, i) => [id, i]));
    battles.forEach((b) => { if (b.venue === null || b.venue === undefined) { b.host = null; b.hostManual = false; } });
    for (const idxs of venueGroups(battles).values()) {
      const used = new Set();
      const free = [];
      for (const i of idxs) {
        const b = battles[i];
        if (b.hostManual) {
          const ok = b.host === null || (!b.players.includes(b.host) && !used.has(b.host) && idxs.some((j) => j !== i && battles[j].players.includes(b.host)));
          if (ok) { if (b.host) used.add(b.host); continue; }
          b.hostManual = false;
        }
        free.push(i);
      }
      const cands = free.map((i) => {
        const list = [];
        for (const j of idxs) if (j !== i) for (const p of battles[j].players) if (rank.has(p) && !used.has(p) && !blocked.has(p)) list.push(p);
        return list.sort((a, c) => rank.get(a) - rank.get(c)).slice(0, 8);
      });
      let best = null;
      if (free.length <= 5) {
        const pick = [], taken = new Set();
        (function dfs(k) {
          if (k === free.length) {
            const covered = pick.filter(Boolean).length;
            const key = [-covered, pick.reduce((s, p) => s + (p ? rank.get(p) : 0), 0), ...pick.map((p) => (p ? rank.get(p) : 1e9))];
            if (!best || lessKey(key, best.key)) best = { key, pick: pick.slice() };
            return;
          }
          for (const p of cands[k]) if (!taken.has(p)) { taken.add(p); pick.push(p); dfs(k + 1); pick.pop(); taken.delete(p); }
          pick.push(null); dfs(k + 1); pick.pop();
        })(0);
      } else {
        // много боёв на одной площадке — жадно по порядку
        const taken = new Set();
        best = { pick: cands.map((list) => { const p = list.find((x) => !taken.has(x)) || null; if (p) taken.add(p); return p; }) };
      }
      free.forEach((i, k) => { battles[i].host = best.pick[k] || null; battles[i].hostManual = false; });
    }
    return battles;
  }

  /* Разложить тур по площадкам и назначить ведущих (ручные назначения сбрасываются). */
  function placeTour(tour, cfg, hostIds, blocked) {
    const plan = venuePlan(tour.battles.length, cfg);
    tour.battles.forEach((b, i) => {
      b.venue = plan ? plan[i].venue : null;
      b.slot = plan ? plan[i].slot : null;
      b.host = null; b.hostManual = false;
    });
    if (plan) assignHosts(tour.battles, hostIds, blocked);
    return tour;
  }

  /* Ведущий финала: первый в списке ведущих, кто не играет в финале. */
  const finalHost = (players, hostIds, blocked) => (hostIds || []).find((id) => !players.includes(id) && !(blocked && blocked.has(id))) || null;

  const fmt = (x) => (Math.round(x * 100) / 100).toString().replace('.', ',');

  return { hostBlocked, tbOrder, headToHead, venuePlan, venueCheck, venueGroups, hostCandidates, assignHosts, placeTour, finalHost, QUAL_TOURS, PTS, battleSizes, sizesFor, battleResult, tourComplete, metPairs, standings, drawFirst, drawSwiss, drawNext, repeatsInTour, fmt, pairKey, TB };
})();
if (typeof module !== 'undefined') module.exports = SG;
