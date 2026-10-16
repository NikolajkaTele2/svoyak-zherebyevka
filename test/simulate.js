const SG = require("../src/engine.js");
function rnd(seed){let s=seed;return()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;}}
let worst=0, fails=0, repeatsTotal=0, trials=0, maxT=0;
for (let N=25; N<=48; N++) for (let t=0;t<150;t++){
  const r=rnd(N*1000+t+7);
  const state={settings:{seed1: t%2?'pots':'sequential'},players:[],tours:[]};
  for(let i=0;i<N;i++) state.players.push({id:'p'+i,name:'P'+i,rating:Math.round(r()*1000)});
  for(let tour=0;tour<4;tour++){
    const t0=Date.now();
    const d=SG.drawNext(state);
    maxT=Math.max(maxT,Date.now()-t0);
    if(d.repeats){fails++;repeatsTotal+=d.repeats;}
    // проверка: все участники ровно один раз, размеры
    const all=d.battles.flatMap(b=>b.players); if(new Set(all).size!==N||all.length!==N) throw 'bad cover';
    const sizes=d.battles.map(b=>b.players.length); if(sizes.some(s=>s<3||s>4)) throw 'bad size';
    for(const b of d.battles) for(const id of b.players){
      const p=state.players.find(x=>x.id===id);
      b.scores[id]=Math.round((p.rating/100 + r()*12 - 4))*10*(r()<0.1?0:1);
    }
    state.tours.push({battles:d.battles});
  }
  // проверить повторы во всех 4 турах
  const seen=new Set(); let rep=0;
  state.tours.forEach(tt=>tt.battles.forEach(b=>{for(let i=0;i<b.players.length;i++)for(let j=i+1;j<b.players.length;j++){const k=SG.pairKey(b.players[i],b.players[j]); if(seen.has(k))rep++; seen.add(k);}}));
  if(rep) worst=Math.max(worst,rep);
  trials++;
}
console.log({trials, toursWithRepeats:fails, repeatsTotal, worst, maxDrawMs:maxT});
// пример распределения
for (const n of [25,30,31,32,47]) console.log(n, SG.battleSizes(n).join('+'));
// пример: проверка делёжки
console.log(SG.battleResult({players:['a','b','c','d'],scores:{a:100,b:50,c:50,d:50}}));
console.log(SG.battleResult({players:['a','b','c'],scores:{a:100,b:100,c:-50}}));
if (fails || worst) { console.error('ОШИБКА: найдены повторные встречи'); process.exit(1); }
console.log('OK: повторных встреч нет');
