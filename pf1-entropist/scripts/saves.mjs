import {ID,assert} from './rules.mjs';
import {escapeHTML as escape} from './adapter.mjs';

const pending=new Set();
const types={'强韧':'fort','反射':'ref','意志':'will'};
const manualUtilitySaves=new Set([
  'Fast Fall','Force Gloves','Magnetic Chain','Pitfall','Quivering Defense',
  'Roiling Flesh','Undead Grip','Writhing Bodies',
]);

export function saveType(text){
  if(/或|任选|见(?:正文|说明|下文)/.test(text))return null;
  const matches=Object.keys(types).filter(label=>text.includes(label));
  return matches.length===1?types[matches[0]]:null;
}

export function utilitySave(talent,dc){
  const save=talent.save?.normalize('NFKC').trim();
  if(talent.kind!=='utility'||manualUtilitySaves.has(talent.en)||!save)return null;
  if(!/^(?:强韧|反射|意志)[\s,]*(?:通过则(?:无效|减半|部分生效)|不信)$/.test(save))return null;
  return {id:talent.id,name:talent.name,kind:talent.kind,save,dc};
}

export function saveOutcome(save,roll){
  const total=roll.total;
  assert(Number.isFinite(total),'PF1 未返回有效的豁免骰结果');
  const natural=roll.isStatic||roll.isNonRoll?null:roll.natural;
  const success=natural===20||(natural!==1&&total>=save.dc);
  const stop=success&&save.kind==='form'&&/通过(?:则)?无效|成功(?:则)?无效|negates/i.test(save.save);
  return {success,stop,total};
}

export function targetSnapshots(tokens){
  const targets=new Map();
  for(const token of tokens??[]){
    const document=token.document??token;
    if(document.actor&&document.uuid)targets.set(document.uuid,{uuid:document.uuid,name:token.name??document.name});
  }
  return [...targets.values()];
}

export function saveControls(saves,targets,prompt='根据命中、范围和法术抗力确认需要豁免的目标，然后按顺序投掷。'){
  if(!saves.length)return '';
  if(!saves.every(save=>saveType(save.save)))return '<p>此组合包含条件豁免，请按原力正文结算。</p>';
  if(!targets.length)return '<p>调用前选定目标可生成逐目标豁免按钮。</p>';
  return `<p>${escape(prompt)}</p>${targets.map(target=>`<p>${escape(target.name)} <button type="button" data-entropist-save="${escape(target.uuid)}">投掷下一项豁免</button></p>`).join('')}`;
}

export function nextSave(saves,records){
  for(let index=0;index<saves.length;index++){
    const record=records.find(result=>result.index===index);
    if(!record)return {index,save:saves[index]};
    if(record.stop)return {stopped:true};
  }
  return {complete:true};
}

function progress(message,uuid){
  const {saves}=message.getFlag(ID,'defense')??{};
  const records=Array.from(game.messages??[]).filter(entry=>entry.isContentVisible!==false).map(entry=>entry.getFlag(ID,'saveResult')).filter(result=>result?.message===message.id&&result.target===uuid);
  return nextSave(saves??[],records);
}

export async function rollTargetSave(message,uuid){
  assert(message.isContentVisible!==false,'没有查看该组合卡的权限');
  const data=message.getFlag(ID,'defense');
  assert(data?.targets?.some(target=>target.uuid===uuid),'目标不在这张组合卡上');
  const key=`${message.id}:${uuid}`;
  assert(!pending.has(key),'该目标正在投掷豁免');
  pending.add(key);
  try{
    const {save,index}=progress(message,uuid);
    if(!save)return;
    const target=await fromUuid(uuid);
    assert(target?.actor?.isOwner,'请由 GM 或目标角色的拥有者投掷豁免');
    const type=saveType(save.save);
    assert(type,'请按正文处理条件豁免');
    const result=await target.actor.rollSavingThrow(type,{dc:save.dc,token:target,chatMessage:false,skipDialog:true});
    if(!result)return;
    const raw=result.rolls?.[0];
    assert(raw,'PF1 未返回豁免骰');
    if(progress(message,uuid).index!==index)return;
    const roll=typeof raw==='string'?Roll.fromJSON(raw):Roll.fromData(raw);
    const outcome=saveOutcome(save,roll);
    const label=outcome.stop?'通过，忽略本次念袭':outcome.success?'通过':'失败';
    const recipients=new Set(message.whisper??[]);
    if(recipients.size&&!message.blind&&message.author?.id)recipients.add(message.author.id);
    result.whisper=[...recipients];
    result.blind=!!message.blind;
    result.content+=`<p>${escape(save.name)} · DC ${save.dc} · ${label}</p>`;
    result.flags??={};
    result.flags[ID]={saveResult:{message:message.id,target:uuid,index,...outcome}};
    return ChatMessage.create(result);
  }finally{pending.delete(key);}
}

export function bindSaveCard(message,html){
  const root=html instanceof HTMLElement?html:html[0];
  for(const button of root?.querySelectorAll('[data-entropist-save]')??[]){
    const uuid=button.dataset.entropistSave;
    const refresh=()=>{
      const status=progress(message,uuid);
      button.disabled=!status.save;
      button.textContent=status.stopped?'塑形豁免通过，念袭无效':status.complete?'豁免已结算':`投掷 ${status.save.name}（DC ${status.save.dc}）`;
    };
    refresh();
    button.onclick=async()=>{
      button.disabled=true;
      try{await rollTargetSave(message,uuid);}
      catch(error){ui.notifications.error(error.message);}
      finally{refresh();}
    };
  }
}
