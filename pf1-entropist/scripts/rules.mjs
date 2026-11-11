export const ID = 'pf1-entropist';
export const VERSION = '0.4.1';
export const ELEMENTS = ['气','土','火','水','以太','光','时间','虚空','毒','音','脏腑','木'];
export const ARRAYS = {elemental:['气','土','火','水'],esoteric:['以太','光','时间','虚空'],material:['毒','音','脏腑','木']};
export const ARRAY_NAMES = {elemental:'元素组列',esoteric:'奥秘组列',material:'物质组列'};
export const FEAT = {extra:'extra-wild-talent-slot',spontaneous:'spontaneous-talent',adaptive:'adaptive-utility'};
export const LABELS = {utility:'通用原力',form:'塑形注能',substance:'性质注能',infusion:'注能（类别待核）',defense:'护身原力',blast:'简易念袭',composite:'复合念袭'};
export const DEFAULT_STATE = {schema:2,array:'elemental',classId:'',levelOverride:null,favored:[],favoredBlasts:{},binding:{energy:'',physical:''},day:0,daily:null,previous:null,prepared:{},extraSlots:[],temporary:null,spontaneousUsed:0,heirloom:true,burn:0,roundBurn:0,roundKey:'',dayNote:''};
export function assert(value,message){if(!value)throw new Error(message);}
export function integer(value,min,max,label){const n=Number(value);assert(Number.isInteger(n)&&n>=min&&n<=max,`${label}应为 ${min}—${max} 的整数`);return n;}
export const half = n => Math.floor(Number(n)/2);
export function availableLevel(k){return Math.min(9,Math.max(1,half(k)));}
export function arrayElements(state){return state.array==='custom'?(state.customArray??[]):(ARRAYS[state.array]??[]);}
export function focusModifier(state,element,k){
  if(['通用','泛用','universal'].includes(element))return 0;
  const daily=state.heirloom===false?null:state.daily?.element;
  const favored=(state.favored??[]).slice(0,k>=15?2:k>=7?1:0);
  if(!daily)return favored.includes(element)?1:0;
  if(!favored.length)return element===daily?1:-1;
  const overlap=favored.includes(daily);
  if(element===daily)return overlap?3:2;
  if(favored.includes(element))return 1;
  return overlap?-2:-1;
}
export function resolveFocus(state,elements,k,selected){
  if(elements?.some(e=>['通用','泛用','universal'].includes(e)))return {modifier:0,element:'泛用'};
  const candidates=[...new Set(elements??[])];
  assert(candidates.length,'条目未能确定元素，请先核对规则资料');
  if(selected){assert(candidates.includes(selected),'选择的元素不属于该原力');return {modifier:focusModifier(state,selected,k),element:selected,selected:true};}
  const mods=candidates.map(e=>focusModifier(state,e,k));
  assert(new Set(mods).size<=1,'此多元素原力涉及不同专注修正，请在调用窗口选择裁定元素');
  return {modifier:mods[0],element:candidates.join('／')};
}
export function slotCapacity({level,constitution,state,extraCount=0}){
  const max=availableLevel(level), mod=Math.floor((constitution-10)/2), result={};
  const locked=state.daily?.locked??0;
  for(let t=1;t<=9;t++){
    const eligible=t<=max&&constitution>=10+t&&t<=max-locked;
    const bonus=level>=3&&mod>=t?1+Math.floor((mod-t)/4):0;
    result[t]=eligible?Math.min(3,1+bonus):0;
  }
  const alloc=state.extraSlots??[];
  assert(alloc.length<=extraCount*2,'额外原力位分配超过专长提供的数量');
  for(const t of alloc){integer(t,1,9,'额外原力位环级');assert(t<max,'额外原力位不能分配给当前最高环');if(result[t])result[t]++;}
  // Locked or constitution-inaccessible tiers are omitted from the monotonic comparison.
  if(alloc.length){let last=Infinity;for(let t=1;t<=max;t++)if(result[t]){assert(result[t]<=last,'高环可用原力位数量不能超过低环');last=result[t];}}
  return result;
}
export function makeDaily(state,{die,level,mode='new',worldTime=0,element, note=''}){
  const s=structuredClone(state), arr=arrayElements(s);
  assert(arr.length===4,'位面组列必须包含四个元素');
  if(mode==='new'){
    integer(die,1,4,'D4 点数');s.previous=s.daily?.element??s.previous;s.day=(s.day??0)+1;
    s.daily={die,element:arr[die-1],blastId:'',locked:0,bendUsed:false,worldTime,note};
    s.temporary=null;s.spontaneousUsed=0;delete s.lastSpontaneous;s.dayNote=note;return s;
  }
  assert(s.daily,'请先开始新一天');
  if(mode==='reroll'){
    assert(level>=9,'扭转命运重掷需要 9 级');assert(!s.daily.bendUsed&&!s.daily.chosen,'当天已经重掷或指定元素');integer(die,1,4,'D4 点数');
    const element=arr[die-1];
    const blastId=element===s.daily.element?s.daily.blastId:'';
    s.daily={...s.daily,die,element,blastId,locked:level>=20?0:1,bendUsed:true,worldTime};return s;
  }
  const fullArray=mode==='full-array';
  assert((mode==='choose'&&level>=17)||(fullArray&&level>=20),'职业等级不足以直接选择元素');
  assert((fullArray?ELEMENTS:arr).includes(element),'所选元素不在本次可选范围内');
  assert(!s.daily.chosen,'当天已经直接选择过元素');
  const locked=fullArray?0:(element===s.previous?3:2)-(level>=20?1:0);
  const blastId=element===s.daily.element?s.daily.blastId:'';
  s.daily={...s.daily,die:null,element,blastId,locked,chosen:true,worldTime};return s;
}
export function calculateDC({talent,stats,state,focusLevel=stats.level,adaptive=false,slot,selectedElement,scope='utility',other=0,competence=0}){
  assert(!talent.incomplete,'仅有索引，缺少原力正文，不能自动计算');
  assert(talent.kind!=='infusion','注能类别尚未确定，不能自动计算');
  const k=stats.level, t=Number(talent.level), kind=scope==='utility'?talent.kind:scope;
  if(kind==='utility')assert(Number.isInteger(talent.level)&&talent.level>=1,'通用原力等级尚待核对，不能按 0 级计算');
  const focus=resolveFocus(state,talent.elements,focusLevel,selectedElement);
  const con=stats.conMod,dex=stats.dexMod;
  const levelTerm=kind==='utility'?(adaptive?half(k):t):Math.min(9,half(k));
  assert(Number.isFinite(levelTerm),'条目缺少可计算的等级');
  const attr=kind==='form'?dex:con;
  const heightened=kind==='utility'&&!adaptive&&Number.isFinite(Number(slot))?Math.max(0,Number(slot)-t):0;
  const effectiveCompetence=Math.max(heightened,Number(competence)||0);
  const dc=10+levelTerm+attr+focus.modifier+effectiveCompetence+(Number(other)||0);
  return {dc,levelTerm,attribute:kind==='form'?'敏捷':'体质',attributeMod:attr,focus, heightened,competence:effectiveCompetence,other:Number(other)||0,cl:Math.max(1,k+focus.modifier),formula:`10 + ${levelTerm}（等级） + ${attr}（${kind==='form'?'敏捷':'体质'}） ${focus.modifier>=0?'+':'−'} ${Math.abs(focus.modifier)}（专注） + ${effectiveCompetence}（表现） + ${Number(other)||0}（其他）`};
}
export function canPrepare(talent,slot,{stats,state,catalog,capacities,ignoreId=null}){
  assert(talent.name!=='防御扩充','熵术士不能选择防御扩充');
  assert(!talent.incomplete,'该条目只有选用表名称，没有完整正文');
  assert(['utility','form','substance'].includes(talent.kind),'该条目不占用普通原力准备位或类别尚待核对');
  assert(Number.isInteger(talent.level)&&talent.level>=1,'原力等级尚待核对，不能自动准备');
  assert(!talent.exempt,'此原力免准备，请在使用资格中启用');
  integer(slot,1,9,'准备位环级');assert(slot>=talent.level,'准备位低于原力等级');
  assert(stats.constitution>=10+talent.level,'体质不足以准备该等级原力');
  assert(talent.level<=availableLevel(stats.level),'职业等级不足以准备该原力');
  const arr=arrayElements(state);assert(talent.elements.some(e=>arr.includes(e)||['通用','泛用'].includes(e)),'原力不属于位面组列或泛用元素');
  const p=state.prepared??{};
  const temporaryUse=state.temporary&&state.temporary.id!==talent.id&&Number(state.temporary.slot)===Number(slot)?1:0;
  const used=Object.entries(p).filter(([id,s])=>id!==ignoreId&&id!==talent.id&&Number(s)===Number(slot)).length+temporaryUse;
  assert(used<(capacities[slot]??0),'该环准备位已满或不可用');
  if(talent.kind==='utility'&&talent.prerequisites){
    const active=new Set([...Object.entries(p).filter(([,rank])=>capacities[rank]>0).map(([id])=>id),...(state.granted??[])]);
    if(state.temporary&&capacities[state.temporary.slot]>0)active.add(state.temporary.id);
    active.delete(talent.id);
    const prerequisite=matchPrerequisites(talent.prerequisites,term=>{
      const matching=catalog.filter(entry=>talentNames(entry).includes(term));
      return matching.length?matching.some(entry=>active.has(entry.id)):null;
    });
    assert(prerequisite!==false,`尚未准备或获得所需原力（${talent.prerequisites}）`);
  }
  return true;
}
export function useSpontaneous(state,{talent,slot,stats,capacities,catalog,time}){
  assert(!state.temporary||state.temporary.expires<=time,'同一时间只能临时获得一个原力');
  assert(time-(state.lastSpontaneous??-Infinity)>=60,'自发原力每分钟只能使用一次');
  assert((state.spontaneousUsed??0)<Math.max(0,stats.conMod),'自发原力每日次数已用尽');
  assert(!state.prepared[talent.id],'该原力已经准备');
  canPrepare(talent,slot,{stats,state,catalog,capacities});
  const next=structuredClone(state);next.temporary={id:talent.id,slot:Number(slot),expires:time+60};next.lastSpontaneous=time;next.spontaneousUsed=(next.spontaneousUsed??0)+1;return next;
}
export function baseBurn(talent,value=talent.burn){
  const text=String(value??'').normalize('NFKC').trim().replace(/^:\s*/,'');
  if(/^\d+$/.test(text))return Number(text);
  if(!/^[-—–−]$/.test(text))return null;
  // Revivification's dash refers to the cost of the healing or revival used.
  return talent.en?.toLowerCase()==='kinetic revivification'?null:0;
}

export function burnLabel(talent,value=talent.burn){
  return baseBurn(talent,value)??'按正文';
}

export function burnCost(state,stats,amount,{roundKey='',inCombat=false}={}){
  integer(amount,0,99,'本次超载');
  if(amount===0)return {state:structuredClone(state),nonlethal:0};
  const maximum=3+stats.conMod;assert((state.burn??0)+amount<=maximum,'超过每日自愿超载上限');
  const roundLimit=1+(stats.level>=6?1+Math.floor((stats.level-6)/3):0);
  const roundBurn=state.roundKey===roundKey?(state.roundBurn??0):0;
  if(inCombat)assert(roundBurn+amount<=roundLimit,'超过本轮超载上限');
  const s=structuredClone(state);s.burn=(s.burn??0)+amount;s.roundBurn=inCombat?roundBurn+amount:0;s.roundKey=roundKey;
  return {state:s,nonlethal:amount*stats.characterLevel};
}

export function talentNames(talent){
  return [talent.name,talent.en,...(talent.aliases??[])].filter(Boolean).map(normalizeTalentName);
}

function normalizeTalentName(name){
  return name.normalize('NFKC').replace(/[†‡*]/g,'').trim().toLowerCase();
}

export function matchPrerequisites(text,match){
  // The catalog uses a flat list of alternatives. Unrecognized requirements remain for manual review.
  const requirements=text.normalize('NFKC').replace(/\([^()]*\)/g,part=>part.replace(/[、,;；或且]/g,' '));
  const alternatives=requirements.split(/或者?|\bor\b/i);
  let unknown=false;
  for(const alternative of alternatives){
    const terms=alternative.split(/[、,;；]|并且|且|\band\b/i).map(term=>normalizeTalentName(term)).filter(Boolean);
    const results=terms.map(term=>match(term)??match(term.replace(/\([^()]*\)/g,'').trim()));
    if(results.length&&results.every(result=>result===true))return true;
    if(!results.length||results.every(result=>result!==false))unknown=true;
  }
  return unknown?null:false;
}
