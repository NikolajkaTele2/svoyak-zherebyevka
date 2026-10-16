// Симуляция турниров: N = 25…48, два режима посева, обычная разбивка и «чётное число боёв».
// Падает, если найдена повторная встреча или неверная разбивка на бои.
const SG = require("../src/engine.js");
function rnd(seed){let s=seed;return()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;}}

// 1. Разбивка на бои
let sizeErrors = 0;
for (let N = 25; N <= 48; N++) {
  for (const even of [false, true]) {
    const s = SG.battleSizes(N, even);
    const sum = s.reduce((a, b) => a + b, 0);
    const ok = sum === N && s.every((x) => x === 3 || x === 4) &&
      s.slice().sort().join() === s.join() &&           // тройки сверху, четвёрки снизу
      (!even || s.length % 2 === 0);
    if (!ok) { sizeErrors++; console.error('Неверная разбивка', N, even, s.join('+')); }
  }
}

// 2. Жеребьёвка 4 туров
let worst=0, fails=0, repeatsTotal=0, trials=0, maxT=0;
for (let N=25; N<=48; N++) for (let t=0;t<200;t++){
  const r=rnd(N*1000+t+7);
  const even = t % 4 >= 2;
  const state={settings:{seed1: t%2?'pots':'sequential', evenBattles: even},players:[],tours:[]};
  for(let i=0;i<N;i++) state.players.push({id:'p'+i,name:'P'+i,rating:Math.round(r()*1000)});
  for(let tour=0;tour<4;tour++){
    const t0=Date.now();
    const d=SG.drawNext(state);
    maxT=Math.max(maxT,Date.now()-t0);
    if(d.repeats){fails++;repeatsTotal+=d.repeats;}
    const all=d.battles.flatMap(b=>b.players); if(new Set(all).size!==N||all.length!==N) throw new Error('bad cover');
    const sizes=d.battles.map(b=>b.players.length);
    if(sizes.join()!==SG.battleSizes(N, even).join()) throw new Error('bad sizes '+N+' '+sizes.join(''));
    for(const b of d.battles) for(const id of b.players){
      const p=state.players.find(x=>x.id===id);
      b.scores[id]=Math.round((p.rating/100 + r()*12 - 4))*10*(r()<0.1?0:1);
    }
    state.tours.push({battles:d.battles});
  }
  const seen=new Set(); let rep=0;
  state.tours.forEach(tt=>tt.battles.forEach(b=>{for(let i=0;i<b.players.length;i++)for(let j=i+1;j<b.players.length;j++){const k=SG.pairKey(b.players[i],b.players[j]); if(seen.has(k))rep++; seen.add(k);}}));
  if(rep) worst=Math.max(worst,rep);
  trials++;
}
console.log({trials, toursWithRepeats:fails, repeatsTotal, worst, maxDrawMs:maxT, sizeErrors});
for (const n of [30,31,32,33,34,35]) console.log(n, SG.battleSizes(n).join('+'), '| чётное:', SG.battleSizes(n, true).join('+'));

// 3. Делёжка мест
const r4 = SG.battleResult({players:['a','b','c','d'],scores:{a:100,b:50,c:50,d:50}});
const r3 = SG.battleResult({players:['a','b','c'],scores:{a:100,b:100,c:-50}});
const splitOk = r4.b.pts === 0.5 && r4.a.pts === 2 && r3.a.pts === 1.5 && r3.c.pts === 0;
if (!splitOk) console.error('Неверная делёжка очков');

if (fails || worst || sizeErrors || !splitOk) { console.error('ОШИБКА'); process.exit(1); }
console.log('OK: повторных встреч нет, разбивка и очки верны');
