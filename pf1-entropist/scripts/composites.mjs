import {assert,arrayElements,baseBurn} from './rules.mjs';
import {blastKind} from './powers.mjs';
import {escapeHTML as e} from './adapter.mjs';

const typeMap={'钝击':'bludgeoning','穿刺':'piercing','挥砍':'slashing','火焰':'fire','寒冷':'cold','强酸':'acid','闪电':'electric','电击':'electric','音波':'sonic','力场':'force','正能量':'positive','负能量':'negative','无类型':'untyped'};
const labels=Object.fromEntries(Object.entries(typeMap).map(([k,v])=>[v,k]));
const physical=['bludgeoning','piercing','slashing'];
const boosts=new Map([
  ['Alteration Amplification','step'],['Gravitic Boost','step'],['Discordant Augmentation','step'],
  ['Aetheric Boost','bonus'],['Resonant Amplification','bonus'],['Esoteric Modification','esoteric'],
  ['Positive Admixture','positive'],['Negative Admixture','negative'],['Complex Negative Admixture','complex']
]);
function damageLine(t){return t.body.match(/(?:[；;\n]|^)\s*伤害(?:类型)?\s*[:：]?\s*([^；;\n]+)/)?.[1]??'';}
function typesIn(line){return [...new Set((line.match(/钝击|穿刺|挥砍|火焰|寒冷|强酸|闪电|电击|音波|力场|正能量|负能量|无类型/g)??[]).map(t=>typeMap[t]))];}
function options(values){return values.map(v=>`<option value="${v}">${labels[v]??v}</option>`).join('');}
export function profileLabel(p){return p.parts.map(part=>`${part.n}d${part.d}${part.b>=0?'＋':'−'}${Math.abs(part.b)}（${part.groups.map(g=>g.map(k=>labels[k]??(k==='nonlethal'?'非致命':k)).join('／')).join('、')}）`).join(' ＋ ');}

async function chooseTypes(t,ask){
  const line=damageLine(t),all=typesIn(line);
  if(t.en==='Epoch Blast')return [['untyped'],['untyped','nonlethal']];
  if(t.en==='Warped Bone Blast'||t.en==='Great Oak Blast'||line.includes('任意两种')){
    const types=physical;
    const answer=await ask(t.name,`<label>第一种物理伤害<select name="a">${options(types)}</select></label><label>第二种物理伤害<select name="b">${options([...types.slice(1),types[0]])}</select></label>`);
    if(!answer)return null;
    assert(types.includes(answer.a)&&types.includes(answer.b)&&answer.a!==answer.b,'请选择两种不同的物理伤害');
    return line.includes('一半')?[[answer.a],[answer.b]]:[[answer.a,answer.b]];
  }
  if(t.en==='Subzero Blast'){
    const value=await ask(t.name,'<label>伤害<select name="type"><option value="cold">寒冷</option><option value="piercing">穿刺</option><option value="both">一半寒冷、一半穿刺</option></select></label>');
    return value?(value.type==='both'?[['cold'],['piercing']]:[[value.type]]):null;
  }
  assert(all.length,`${t.name}的正文未给出可辨识的伤害类型`);
  if(line.includes('或')&&all.length>1){
    const halves=line.split(/(?:一半|各半)/).filter(Boolean);
    const alternatives=typesIn(halves.length>1?halves.at(-1):line).filter(v=>physical.includes(v));
    const fixed=all.filter(v=>!alternatives.includes(v));
    if(alternatives.length>1){
      const answer=await ask(t.name,`<label>本次物理伤害<select name="type">${options(alternatives)}</select></label>`);
      if(!answer)return null;
      assert(alternatives.includes(answer.type),'请选择有效的伤害类型');
      return [...fixed,answer.type].map(k=>[k]);
    }
  }
  if(t.en==='Verdant Blast'){
    const answer=await ask(t.name,'<label><input type="checkbox" name="positive">本次同时视为正能量伤害</label>');
    return answer?[[...physical,...(answer.positive==='on'?['positive']:[])]]:null;
  }
  return line.includes('一半')?all.map(k=>[k]):[all];
}

export function boostBases(t,available,level){
  const boost=boosts.get(t.en);
  if(!boost)return [];
  return available.filter(b=>{
      if(boosts.has(b.en)||b.id==='entropist-array-blast')return false;
      const kind=blastKind(b);
      if(['positive','negative','complex'].includes(boost)&&kind!=='energy')return false;
      if(t.en==='Positive Admixture'&&b.en==='Positive Blast'||t.en==='Negative Admixture'&&b.en==='Negative Blast')return false;
      if(t.en==='Resonant Amplification'&&kind!=='energy'||t.en==='Discordant Augmentation'&&kind!=='physical')return false;
      if(boost==='complex')return b.kind==='composite'&&baseBurn(b)!==null&&baseBurn(b)<=2;
      return b.kind==='blast'||(!['positive','negative'].includes(boost)&&(level>=15||boost==='esoteric'));
    });
}

export async function compositeProfile(t,available,state,stats,catalog,ask,baseFilter){
  if(t.kind!=='composite')return null;
  if(t.id==='entropist-array-blast'){
    const array=arrayElements(state);
    const pool=[...new Set(catalog.filter(b=>b.kind==='blast'&&b.elements.some(x=>array.includes(x))).flatMap(b=>typesIn(damageLine(b))))];
    assert(pool.length,'组列中没有可用的伤害类型');
    const answer=await ask(t.name,Array.from({length:4},(_,i)=>`<label>第 ${i+1} 项伤害<select name="t${i}">${options([...pool.slice(i%pool.length),...pool.slice(0,i%pool.length)])}</select></label>`).join(''));
    if(!answer)return;
    const types=Array.from({length:4},(_,i)=>answer['t'+i]);
    assert(types.every(k=>pool.includes(k))&&new Set(types).size===Math.min(4,pool.length),'须先选遍可用类型，再按规则重复');
    const kind=types.some(k=>physical.includes(k))?'physical':'energy';
    return {kind,extra:0,parts:types.map(k=>({n:10,d:['force','sonic','untyped'].includes(k)?4:6,b:kind==='physical'?10:0,groups:[k==='untyped'?[k,'nonlethal']:[k]]}))};
  }
  const boost=boosts.get(t.en);
  let base=t,extra=0;
  if(boost){
    const bases=boostBases(t,available,stats.level).filter(b=>!baseFilter||baseFilter(b));
    assert(bases.length,'当前专注没有可供本次增幅的基础念袭');
    const answer=await ask(t.name,`<label>被强化的念袭<select name="base">${bases.map(b=>`<option value="${e(b.id)}">${e(b.name)}</option>`).join('')}</select></label>`);
    if(!answer)return;
    base=bases.find(b=>b.id===answer.base);assert(base,'基础念袭无效');
    if(base.kind==='composite'&&boost!=='complex')extra=(baseBurn(base)??0)+(boost==='esoteric'?2:1);
  }
  const groups=await chooseTypes(base,ask);if(!groups)return;
  const kind=blastKind(base)??(groups.flat().some(k=>physical.includes(k))?'physical':'energy');
  const simple=base.kind==='blast'||['Force Blast','Regression Blast','Flashbang Blast'].includes(base.en);
  let n=Math.ceil(stats.level/2)*(simple?1:2);
  if(['positive','negative'].includes(boost))n=Math.ceil(stats.level/2)*2;
  const lowered=['Chrono Blast','Epoch Blast','Regression Blast','Sonic Blast','Sonic Boom Blast','Shatterstorm Blast'].includes(base.en);
  let d=lowered?4:['Supernova Blast','Hellfire Blast'].includes(base.en)?8:6;
  let perDie=(kind==='physical'?1:0)+Number(base.body.match(/每个(?:1d6)?伤害骰额外(?:多)?造成\s*([12])\s*点/)?.[1]??0);
  if(boost==='bonus')perDie++;
  if(boost==='esoteric')perDie+=2;
  if(boost==='esoteric'||boost==='step')d=[4,6,8,10,12][Math.min(4,[4,6,8,10,12].indexOf(d)+(boost==='esoteric'?2:1))];
  if(['positive','negative'].includes(boost))groups.unshift([boost]);
  const b=n*perDie+(kind==='physical'?stats.conMod:Math.floor(stats.conMod/2));
  const parts=[{n,d,b,groups}];
  if(boost==='complex')parts.push({n:Math.floor(n/2),d:6,b:0,groups:[['negative']]});
  return {kind,extra,parts,baseId:base.id,baseName:base.name};
}
