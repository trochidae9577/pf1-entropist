import {ID,assert,availableLevel} from './rules.mjs';

export function learningAccount(actor,state,stats){
  const records=new Map();
  for(const record of [...(state.pastLearning??[]),...Array.from(actor.items,i=>i.getFlag(ID,'learning'))]){
    if(record?.key)records.set(record.key,record);
  }
  const entries=[...records.values()];
  const initial=entries.filter(r=>r.source==='initial');
  const quota=initial[0]?.quota??Math.max(0,3+stats.conMod);
  const levels=Array.from({length:Math.max(0,stats.level-1)},(_,i)=>i+2).filter(n=>!entries.some(r=>r.source==='upgrade'&&r.level===n));
  const hours=entries.reduce((sum,r)=>sum+(r.hours??0),0);
  const gold=entries.reduce((sum,r)=>sum+(r.gold??0),0);
  return {initial:initial.length,quota,levels,hours,gold};
}

export function learningRecord(source,talent,account){
  if(source==='external')return {source};
  assert(['form','substance','utility'].includes(talent.kind)&&Number.isInteger(talent.level)&&talent.level>0,'请选择有固定等级的注能或通用原力');
  assert(!talent.name.startsWith('基础'),'基础通用原力由专注授予');
  if(source==='initial'){
    assert(talent.level===1&&account.initial<account.quota,'初始原力须为 1 级且尚有初始名额');
    return {source,quota:account.quota};
  }
  if(source==='study')return {source,hours:8*talent.level,gold:300*talent.level};
  const level=Number(source.replace(/^upgrade-/,''));
  assert(source==='upgrade-'+level&&account.levels.includes(level),'该升级名额已使用或尚未取得');
  assert(talent.level<=availableLevel(level),'原力等级高于当次升级允许的等级');
  return {source:'upgrade',level};
}
