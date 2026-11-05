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
  /* Дополнительные показатели. Личная встреча — не пункт списка, а проверка перед каждым показателем (h2hEach). */
  const TB = {
    score: { label: 'Сумма баллов', short: 'Баллы', get: (r) => r.score },
    buch: { label: 'Сила соперников', short: 'Сила соп.', get: (r) => r.opp },
  };
  const TB_DEFAULT = ['score', 'buch'];
  const SEP = { h2h: 'личн. встреча', score: 'баллы', buch: 'сила соп.', shoot: 'перестрелка', rating: 'рейтинг', shared: 'делят' };
  /* Порядок показателей из настроек (старые «h2h» и «rating» в списке игнорируются). */
  function tbOrder(state) {
    const raw = (state.settings && state.settings.tiebreaks) || TB_DEFAULT;
    const out = [];
    raw.forEach((k) => { if (TB[k] && !out.includes(k)) out.push(k); });
    TB_DEFAULT.forEach((k) => { if (!out.includes(k)) out.push(k); });
    return out;
  }
  const h2hOn = (state) => !(state.settings && state.settings.h2hEach === false);
  const groupKey = (ids) => ids.slice().sort().join(',');

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
    const useH2H = h2hOn(state);
    const shootouts = (state.shootouts) || {};
    const fullTies = [];
    const eq = (a, b) => Math.abs(a - b) < 1e-9;
    // разбить отсортированный по убыванию key массив на группы равных
    const split = (arr, key) => {
      const out = [];
      arr.forEach((r) => { const last = out[out.length - 1]; if (last && eq(key(last[0]), key(r))) last.push(r); else out.push([r]); });
      return out;
    };
    // Разбить группу по ключу; на стыке частей запомнить, чем решено (sep у последнего в части).
    const splitBy = (group, key, crit, next) => {
      const parts = split(group.slice().sort((a, b) => key(b) - key(a)), key);
      return parts.flatMap((g, i) => { const r = next(g); if (i < parts.length - 1) r[r.length - 1].sep = crit; return r; });
    };
    // Равные по очкам: перед каждым показателем пробуем личную встречу (если каждый играл с каждым).
    // Кто остался равным после показателя — для них снова личная встреча, затем следующий показатель.
    function rankGroup(group, k, h2hTried) {
      if (group.length < 2) return group;
      if (useH2H && !h2hTried) {
        const s = headToHead(group, met);
        if (s && new Set(group.map((r) => s.get(r.id))).size > 1) {
          group.forEach((r) => { r.h2h = s.get(r.id); });
          return splitBy(group, (r) => s.get(r.id), 'h2h', (g) => rankGroup(g, k, false));
        }
      }
      if (k < order.length) return splitBy(group, TB[order[k]].get, order[k], (g) => rankGroup(g, k + 1, false));
      // полное равенство: порядок из перестрелки, если введён, иначе по рейтингу
      const manual = shootouts[groupKey(group.map((r) => r.id))];
      const sorted = manual
        ? group.slice().sort((a, b) => manual.indexOf(a.id) - manual.indexOf(b.id))
        : group.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'ru'));
      fullTies.push({ rows: sorted, manual: !!manual });
      sorted.forEach((r, i) => { if (i < sorted.length - 1) r.sep = manual ? 'shoot' : 'rating'; });
      return sorted;
    }
    const byPts = Object.values(rows).sort((a, b) => b.pts - a.pts);
    const list = split(byPts, (r) => r.pts).flatMap((g) => rankGroup(g, 0, false));
    list.forEach((row, i) => { row.rank = i + 1; row.placeFrom = row.placeTo = i + 1; row.place = String(i + 1); });
    // Полное равенство: на границе тройки — нужна перестрелка; с 4-го места и ниже — места делятся.
    list.shootout = null;
    fullTies.forEach((t) => {
      const from = t.rows[0].rank, to = t.rows[t.rows.length - 1].rank;
      if (from <= 3 && to >= 4) {
        if (!t.manual) list.shootout = { ids: t.rows.map((r) => r.id), from, to, key: groupKey(t.rows.map((r) => r.id)) };
        // по регламенту: результат перестрелки за выход в тройку для оставшихся не учитывается — они делят места
        const rest = t.rows.filter((r) => r.rank >= 4);
        if (t.manual && rest.length > 1) rest.forEach((r, i) => { r.placeFrom = rest[0].rank; r.placeTo = rest[rest.length - 1].rank; r.place = r.placeFrom + '–' + r.placeTo; if (i < rest.length - 1) r.sep = 'shared'; });
      } else if (from >= 4) {
        t.rows.forEach((r, i) => { r.placeFrom = from; r.placeTo = to; r.place = from + '–' + to; if (i < t.rows.length - 1) r.sep = 'shared'; });
      }
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
    if (cfg.order === 'pairs') {
      // соседние по силе бои — на одной площадке в разных волнах: 1 и 2, 3 и 4, …
      const K = Math.max(1, cfg.perVenue | 0 || 1);
      return Array.from({ length: m }, (_, i) => { const g = Math.floor(i / K); return { venue: g % V, slot: (i % K) + 1 + K * Math.floor(g / V) }; });
    }
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
  /* Отдых ведущих. rest = 2: кто вёл в двух предыдущих турах подряд, в туре t не назначается;
     rest = 1: кто вёл в предыдущем туре, в туре t не назначается. */
  function hostBlocked(tours, t, rest, maxRun, noAhead) {
    if (rest === 'slots') return busyRule(tours, t, maxRun || 5, t < QUAL_TOURS - 1 && !noAhead);
    const hosted = (k) => new Set(k >= 0 && tours[k] ? tours[k].battles.map((b) => b.host).filter(Boolean) : []);
    const a = hosted(t - 1);
    if (rest === 1) return a;
    const b = hosted(t - 2);
    return new Set([...a].filter((id) => b.has(id)));
  }

  /* Правило занятости по слотам: у каждого тура столько слотов, сколько волн; в слоте человек занят,
     если играет или ведёт. Ведущим не назначается тот, у кого получилось бы L занятых слотов подряд
     (считая прошлые туры и свою игру в этом туре). Финал не считается. */
  function busyRule(tours, t, L, ahead) {
    const hist = new Map();
    let len = 0;
    const mark = (id, s) => { if (!hist.has(id)) hist.set(id, new Set()); hist.get(id).add(s); };
    for (let k = 0; k < t && k < tours.length; k++) {
      const bs = tours[k].battles;
      const W = Math.max(1, ...bs.map((b) => b.slot || 1));
      bs.forEach((b) => { const s = len + (b.slot || 1) - 1; b.players.forEach((p) => mark(p, s)); if (b.host) mark(b.host, s); });
      len += W;
    }
    const tail = (id) => { const h = hist.get(id); let n = 0; while (h && h.has(len - 1 - n)) n++; return n; };
    // ahead: свою игру в следующем туре человек может получить в первой волне — считаем её занятой,
    // чтобы правило не нарушилось потом из-за жеребьёвки
    const longest = (id, cur, W, look) => { let r = tail(id), best = r; for (let s = 1; s <= W; s++) { if (cur.has(s)) { r++; if (r > best) best = r; } else r = 0; } if (look && r > 0 && r + 1 > best) best = r + 1; return best; };
    return {
      L,
      has: () => false, // финал не считается: перед ним перерыв, и ведущий его почти всегда не из тройки
      forBattles(bs) {
        const W = Math.max(1, ...bs.map((b) => b.slot || 1));
        const play = new Map(); bs.forEach((b) => b.players.forEach((p) => play.set(p, b.slot || 1)));
        return { has: (id, slot) => slot !== undefined && slot !== null && longest(id, new Set([play.get(id), slot]), W, ahead) >= L };
      },
      // сколько человек уже с L подряд из-за своей игры и ведения в этом туре (для раскладки «под ведущих»)
      violations(bs) {
        const W = Math.max(1, ...bs.map((b) => b.slot || 1));
        const cur = new Map();
        bs.forEach((b) => { b.players.forEach((p) => { if (!cur.has(p)) cur.set(p, new Set()); cur.get(p).add(b.slot || 1); }); if (b.host) { if (!cur.has(b.host)) cur.set(b.host, new Set()); cur.get(b.host).add(b.slot || 1); } });
        let n = 0; for (const [id, set] of cur) if (longest(id, set, W) >= L) n++;
        return n;
      },
    };
  }
  const blockFor = (blocked, battles) => (blocked && blocked.forBattles ? blocked.forBattles(battles) : blocked || new Set());

  /* scope: 'venue' — отдыхающие на той же площадке; 'all' — все, кто не играет в эту волну (тот же номер боя на площадке). */
  const isFree = (o, b, scope) => (scope === 'all' ? o.slot !== b.slot : o.venue === b.venue);
  function hostCandidates(battles, bi, hostIds, blocked, scope) {
    const bl = blockFor(blocked, battles);
    const b = battles[bi];
    const rank = new Map((hostIds || []).map((id, i) => [id, i]));
    const out = [];
    if (!b || b.venue === null || b.venue === undefined) return out;
    battles.forEach((o, oi) => {
      if (oi === bi || o.venue === null || o.venue === undefined || !isFree(o, b, scope)) return;
      o.players.forEach((id) => out.push({ id, battle: oi, venue: o.venue, sameVenue: o.venue === b.venue, rank: rank.has(id) ? rank.get(id) : null, blocked: !!bl.has(id, b.slot) }));
    });
    return out.sort((a, c) => (a.blocked - c.blocked) || (a.rank === null ? 1e9 : a.rank) - (c.rank === null ? 1e9 : c.rank) || (c.sameVenue - a.sameVenue) || a.battle - c.battle);
  }

  /* Ведущие из всех свободных: подбор сразу по всему туру. Кандидаты берутся в порядке списка,
     каждый добавляется, если для него находится бой (с перестановкой уже назначенных) — так закрывается
     максимум боёв и используются самые приоритетные. При выборе боя для человека — сначала его площадка. */
  function assignHostsAll(battles, rank, blocked) {
    const idx = battles.map((b, i) => i).filter((i) => battles[i].venue !== null && battles[i].venue !== undefined);
    const used = new Set(), matchB = new Map(), matchH = new Map();
    const playsIn = new Map(); idx.forEach((i) => battles[i].players.forEach((p) => playsIn.set(p, i)));
    for (const i of idx) {
      const b = battles[i];
      if (!b.hostManual) continue;
      const hb = b.host === null ? null : playsIn.get(b.host);
      const ok = b.host === null || (hb !== undefined && battles[hb].slot !== b.slot && !used.has(b.host));
      if (ok) { if (b.host) used.add(b.host); matchB.set(i, b.host); } else b.hostManual = false;
    }
    const free = idx.filter((i) => !matchB.has(i));
    const adj = (h) => {
      const own = battles[playsIn.get(h)];
      return free.filter((i) => battles[i].slot !== own.slot && !blocked.has(h, battles[i].slot)).sort((x, y) => ((battles[y].venue === own.venue) - (battles[x].venue === own.venue)) || x - y);
    };
    const tryAssign = (h, seen) => {
      for (const i of adj(h)) {
        if (seen.has(i)) continue;
        seen.add(i);
        const cur = matchB.get(i);
        if (cur === undefined || tryAssign(cur, seen)) { matchB.set(i, h); matchH.set(h, i); return true; }
      }
      return false;
    };
    const hosts = [...rank.keys()].filter((h) => playsIn.has(h) && !used.has(h) && !blocked.has(h)).sort((a, c) => rank.get(a) - rank.get(c));
    for (const h of hosts) tryAssign(h, new Set());
    // те же люди, но перестановкой между боями — побольше ведущих на своей площадке
    const canHost = (h, i) => battles[playsIn.get(h)].slot !== battles[i].slot && !blocked.has(h, battles[i].slot);
    const home = (h, i) => (battles[playsIn.get(h)].venue === battles[i].venue ? 1 : 0);
    for (let improved = true, guard = 0; improved && guard < 50; guard++) {
      improved = false;
      for (const i of free) for (const j of free) {
        if (i >= j) continue;
        const hi = matchB.get(i), hj = matchB.get(j);
        if (hi !== undefined && hj !== undefined) {
          if (canHost(hi, j) && canHost(hj, i) && home(hi, j) + home(hj, i) > home(hi, i) + home(hj, j)) { matchB.set(i, hj); matchB.set(j, hi); improved = true; }
        } else if (hi !== undefined && hj === undefined) {
          if (canHost(hi, j) && home(hi, j) > home(hi, i)) { matchB.delete(i); matchB.set(j, hi); improved = true; }
        } else if (hj !== undefined && hi === undefined) {
          if (canHost(hj, i) && home(hj, i) > home(hj, j)) { matchB.delete(j); matchB.set(i, hj); improved = true; }
        }
      }
    }
    free.forEach((i) => { battles[i].host = matchB.has(i) ? matchB.get(i) : null; battles[i].hostManual = false; });
    return battles;
  }

  const lessKey = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

  /* Назначить ведущих. На каждой площадке: один человек ведёт не больше одного боя за тур;
     сначала стараемся закрыть ведущими все бои, затем берём тех, кто выше в списке ведущих.
     Назначенные вручную (hostManual) сохраняются, если всё ещё допустимы. */
  function assignHosts(battles, hostIds, blocked, scope) {
    blocked = blockFor(blocked, battles);
    const rank = new Map((hostIds || []).map((id, i) => [id, i]));
    battles.forEach((b) => { if (b.venue === null || b.venue === undefined) { b.host = null; b.hostManual = false; } });
    if (scope === 'all') return assignHostsAll(battles, rank, blocked);
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
        for (const j of idxs) if (j !== i) for (const p of battles[j].players) if (rank.has(p) && !used.has(p) && !blocked.has(p, battles[i].slot)) list.push(p);
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
  function placeTour(tour, cfg, hostIds, blocked, scope) {
    const hostsMode = cfg && cfg.order === 'hosts';
    const plan = venuePlan(tour.battles.length, hostsMode ? Object.assign({}, cfg, { order: 'waves' }) : cfg);
    tour.battles.forEach((b, i) => {
      b.venue = plan ? plan[i].venue : null;
      b.slot = plan ? plan[i].slot : null;
      b.host = null; b.hostManual = false;
    });
    if (!plan) return tour;
    if (hostsMode && hostIds && hostIds.length && tour.battles.length > 1) optimizePlacement(tour.battles, plan, hostIds, blocked, scope);
    else assignHosts(tour.battles, hostIds, blocked, scope);
    return tour;
  }

  /* Раскладка «под ведущих»: состав боёв не меняется, меняется только площадка и волна каждого боя.
     Цель по порядку: 1) больше боёв с ведущим; 2) меньше сумма мест ведущих в списке (вести достаётся тем, кто выше);
     3) больше ведущих на своей площадке; 4) ближе к обычной раскладке по кругу.
     Поиск: обмены боёв местами до улучшения, с нескольких стартов (детерминированно). */
  function optimizePlacement(battles, plan, hostIds, blocked, scope) {
    const M = battles.length, rank = new Map(hostIds.map((id, i) => [id, i]));
    const evalP = (perm) => {
      const bs = battles.map((b, i) => ({ players: b.players, venue: plan[perm[i]].venue, slot: plan[perm[i]].slot, host: null, hostManual: false }));
      assignHosts(bs, hostIds, blocked, scope);
      const where = new Map(); bs.forEach((b) => b.players.forEach((p) => where.set(p, b)));
      let hosted = 0, sum = 0, same = 0, disp = 0;
      bs.forEach((b, i) => {
        if (b.host) { hosted++; sum += rank.get(b.host); const own = where.get(b.host); if (own && own.venue === b.venue) same++; }
        disp += Math.abs(perm[i] - i);
      });
      const viol = blocked && blocked.violations ? blocked.violations(bs) : 0;
      return { key: [viol, -hosted, sum, -same, disp], bs };
    };
    const better = (a, b) => { for (let k = 0; k < 5; k++) if (a.key[k] !== b.key[k]) return a.key[k] < b.key[k]; return false; };
    let seed = 7 + M;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ident = Array.from({ length: M }, (_, i) => i);
    const starts = [ident.slice()];
    for (let r = 0, R = M <= 10 ? 8 : M <= 13 ? 4 : 2; r < R; r++) { const p = ident.slice(); for (let i = M - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } starts.push(p); }
    let best = null, bestPerm = null;
    for (const start of starts) {
      let cur = start, c = evalP(cur), improved = true;
      while (improved) {
        improved = false;
        for (let i = 0; i < M; i++) for (let j = i + 1; j < M; j++) {
          [cur[i], cur[j]] = [cur[j], cur[i]];
          const cc = evalP(cur);
          if (better(cc, c)) { c = cc; improved = true; } else [cur[i], cur[j]] = [cur[j], cur[i]];
        }
      }
      if (!best || better(c, best)) { best = c; bestPerm = cur.slice(); }
    }
    battles.forEach((b, i) => { b.venue = best.bs[i].venue; b.slot = best.bs[i].slot; b.host = best.bs[i].host; b.hostManual = false; });
    return bestPerm;
  }

  /* Ведущий финала: первый в списке ведущих, кто не играет в финале. */
  const finalHost = (players, hostIds, blocked) => (hostIds || []).find((id) => !players.includes(id) && !(blocked && blocked.has(id))) || null;

  /* ---------- Кубковые очки и итоговая таблица ---------- */
  // 1 — «Ф», 2 — 25, 3 — 20, 4 — 17, 5 — 15, 6 — 14 … 19 — 1, 20 и ниже — 0
  const cupForPlace = (p) => (p === 1 ? 'Ф' : p === 2 ? 25 : p === 3 ? 20 : p === 4 ? 17 : p <= 19 ? 20 - p : 0);
  /* Поделённые места from–to: очки усредняются ((15 + 14) / 2 = 14,5). Ничья за 1-е место — null: нужна перестрелка. */
  function cupPoints(from, to) {
    if (to === undefined) to = from;
    if (from === 1) return to === 1 ? 'Ф' : null;
    let s = 0;
    for (let p = from; p <= to; p++) s += cupForPlace(p);
    return Math.round((s / (to - from + 1)) * 100) / 100;
  }
  const parsePlace = (s) => { const m = String(s).split(/[–-]/).map(Number); return { from: m[0], to: m[1] || m[0] }; };

  /* Итог турнира: места 1–3 — по финальному бою, дальше — по таблице отборочных туров. */
  function finalStandings(state) {
    const st = standings(state, 4);
    const fin = state.final;
    const res = fin ? battleResult(fin) : null;
    const finIds = fin ? fin.players : [];
    const out = [];
    if (fin) {
      const order = finIds.slice().sort((a, b) => (res ? Number(fin.scores[b]) - Number(fin.scores[a]) : 0) || st.findIndex((r) => r.id === a) - st.findIndex((r) => r.id === b));
      order.forEach((id) => {
        const q = st.find((r) => r.id === id);
        const pl = res ? parsePlace(res[id].place) : null;
        out.push({ id, name: q.name, finalist: true, place: pl ? (pl.from === pl.to ? String(pl.from) : pl.from + '–' + pl.to) : 'финал', from: pl ? pl.from : null, to: pl ? pl.to : null, cup: pl ? cupPoints(pl.from, pl.to) : null, qPts: q.pts, qRank: q.rank, finalScore: res ? Number(fin.scores[id]) : null });
      });
    }
    let p = finIds.length + 1;
    const sameTop = finIds.length && finIds.every((id) => st.findIndex((r) => r.id === id) < finIds.length);
    st.filter((r) => !finIds.includes(r.id)).forEach((r) => {
      // равные с 4-го места делят места и кубковые очки (сумма очков за эти места поровну)
      const from = sameTop ? r.placeFrom : p, to = sameTop ? r.placeTo : p;
      out.push({ id: r.id, name: r.name, finalist: false, place: from === to ? String(from) : from + '–' + to, from, to, cup: fin ? cupPoints(from, to) : null, qPts: r.pts, qRank: r.rank, finalScore: null });
      p++;
    });
    const tieForFirst = !!(res && out.some((r) => r.finalist && r.from === 1 && r.to > 1));
    return { rows: out, played: !!res, tieForFirst };
  }

  /* Снимок турнира для Google Таблицы: всё уже посчитано, скрипт таблицы только рисует. */
  function sheetSnapshot(state) {
    const pl = Object.fromEntries(state.players.map((p) => [p.id, p]));
    const nm = (id) => (id && pl[id] ? pl[id].name : null);
    // стартовый номер — как в списке участников: по рейтингу, при равенстве — порядок списка
    const seed = Object.fromEntries(state.players.slice().sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0)).map((p, i) => [p.id, i + 1]));
    const names = ((state.settings && state.settings.venues && state.settings.venues.names) || []).map((x) => String(x || '').trim());
    const rounds = state.tours.map((t) => {
      const M = t.battles.length, hasV = t.battles.some((b) => b.venue !== null && b.venue !== undefined);
      const V = hasV ? 0 : Math.min(5, Math.ceil(M / 2)) || 1;
      return {
        battles: t.battles.map((b, bi) => {
          const res = battleResult(b);
          const venue = hasV ? b.venue : bi % V, slot = hasV ? b.slot || 1 : Math.floor(bi / V) + 1;
          return {
            n: bi + 1, venue, slot, venueName: hasV ? names[venue] || 'Площадка ' + (venue + 1) : '', host: nm(b.host),
            players: b.players.map((id) => {
              const s = b.scores[id];
              return { seed: seed[id], name: nm(id), score: s === null || s === undefined || s === '' ? null : Number(s), pts: res ? res[id].pts : null };
            }),
          };
        }),
      };
    });
    const played = state.tours.filter(tourComplete).length;
    const st = standings(state);
    const fin = state.final;
    const fs = fin ? finalStandings(state) : null;
    const res = fs && fs.played && !fs.tieForFirst ? fs : null;
    const byFs = res ? Object.fromEntries(res.rows.map((r) => [r.id, r])) : {};
    const finIds = new Set(fin ? fin.players : []);
    const table = (played ? st : st.slice().sort((a, b) => seed[a.id] - seed[b.id])).map((r) => ({
      place: played ? r.place : null, rank: played ? r.rank : null, name: r.name,
      rounds: [0, 1, 2, 3].map((t) => (r.perTour[t] ? { pts: r.perTour[t].pts, score: r.perTour[t].score, battle: r.perTour[t].battle } : null)),
      pts: played ? r.pts : null, score: played ? r.score : null, opp: played ? Math.round(r.opp * 100) / 100 : null,
      finalist: finIds.has(r.id), finalPlace: byFs[r.id] ? byFs[r.id].place : null, cup: byFs[r.id] ? byFs[r.id].cup : null,
    }));
    let final = null;
    if (fin) {
      const fr = battleResult(fin);
      final = {
        host: nm(fin.host),
        players: fin.players.map((id) => ({ name: nm(id), score: fin.scores[id] === null || fin.scores[id] === undefined || fin.scores[id] === '' ? null : Number(fin.scores[id]), place: fr ? fr[id].place : null }))
          .sort((a, b) => (fr ? b.score - a.score : 0)),
      };
    }
    return {
      v: 1, id: state.id || null, name: state.name || '', savedAt: state.savedAt || 0, played,
      rounds, table, final,
      result: res ? res.rows.map((r) => ({ name: r.name, place: r.place, cup: r.cup })) : null,
    };
  }

  const fmt = (x) => (Math.round(x * 100) / 100).toString().replace('.', ',');

  return { blockFor, sheetSnapshot, SEP, groupKey, cupForPlace, cupPoints, finalStandings, hostBlocked, tbOrder, headToHead, venuePlan, venueCheck, venueGroups, hostCandidates, assignHosts, placeTour, finalHost, QUAL_TOURS, PTS, battleSizes, sizesFor, battleResult, tourComplete, metPairs, standings, drawFirst, drawSwiss, drawNext, repeatsInTour, fmt, pairKey, TB };
})();
if (typeof module !== 'undefined') module.exports = SG;
