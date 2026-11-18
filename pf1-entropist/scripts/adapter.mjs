import {ID,activePreparation,DEFAULT_STATE,FEAT,availableLevel,slotCapacity,assert,burnLabel} from './rules.mjs';
const queues=new Map();
export function readState(actor){
  const raw=actor.getFlag(ID,'state');let data={};
  try{data=typeof raw==='string'?JSON.parse(raw):(raw??{});}catch{throw new Error('熵术士设置无法读取，请保留角色备份后检查');}
  const state={...structuredClone(DEFAULT_STATE),...structuredClone(data)};
  if(state.schema===1||state.blasts){
    for(const element of state.favored){
      if(state.blasts?.[element])state.favoredBlasts[element]??=state.blasts[element];
    }
    if(state.daily)state.daily.blastId??=state.blasts?.[state.daily.element]??'';
    delete state.blasts;
    state.schema=DEFAULT_STATE.schema;
  }
  if(state.temporary&&state.temporary.expires<=(globalThis.game?.time?.worldTime??0))state.temporary=null;
  return state;
}
export function actorStats(actor,state=readState(actor)){
  const classes=Array.from(actor.items??[]).filter(i=>i.type==='class');
  const cls=classes.find(i=>i.id===state.classId)??classes.find(i=>/kineticist|entropist|操念使|熵术士/i.test((i.system.tag??'')+' '+i.name));
  const level=state.levelOverride??Number(cls?.system.level??0);
  const standardClasses=classes.filter(c=>!['racial','mythic'].includes(c.subType));
  const classTotal=standardClasses.reduce((sum,c)=>sum+Number(c.system.level??0),0);
  const sheetTotal=Number(actor.system.details?.level?.value??classTotal);
  let characterLevel=sheetTotal;
  if(state.levelOverride!=null){
    // Replace only the bound class's contribution, preserving multiclass levels.
    const boundLevel=standardClasses.includes(cls)?Number(cls.system.level??0):0;
    characterLevel=cls?Math.max(0,sheetTotal-boundLevel)+Number(level):Math.max(sheetTotal,Number(level));
  }
  const con=actor.system.abilities?.con??{},dex=actor.system.abilities?.dex??{};
  return {level:Number(level),constitution:Number(con.total??con.value??10),conMod:Number(con.mod??Math.floor(((con.total??con.value??10)-10)/2)),dexMod:Number(dex.mod??Math.floor(((dex.total??dex.value??10)-10)/2)),characterLevel,classId:cls?.id??''};
}
export function featCounts(actor){
  const count={extra:0,spontaneous:0,adaptive:0};
  for(const item of actor.items??[])if(item.type==='feat')for(const [key,id]of Object.entries(FEAT))if(item.getFlag(ID,'featId')===id)count[key]++;
  return count;
}
export function capacities(actor,state=readState(actor),validateAllocation=false){
  const stats=actorStats(actor,state),feats=featCounts(actor);
  assert(stats.level>=1&&stats.level<=20,'先绑定操念使职业，或填写 1—20 的职业等级');
  const extraCount=stats.level>=5&&stats.constitution>=17?feats.extra:0;
  const params={level:stats.level,constitution:stats.constitution,extraCount};
  if(validateAllocation)return slotCapacity({...params,state});
  const extraSlots=(state.extraSlots??[]).slice(0,2*extraCount).filter(rank=>rank<availableLevel(stats.level));
  // A temporary level or ability loss can invalidate saved allocations.
  try{return slotCapacity({...params,state:{...state,extraSlots}});}
  catch{return slotCapacity({...params,state:{...state,extraSlots:[]}});}
}
export async function serializeActor(actor,operation){
  assert(actor.isOwner,'你没有修改该角色的权限');
  const key=actor.uuid??actor.id,previous=queues.get(key)??Promise.resolve();
  const next=previous.catch(()=>{}).then(operation);
  queues.set(key,next);
  try{return await next;}finally{if(queues.get(key)===next)queues.delete(key);}
}
export async function transact(actor,operation){
  return serializeActor(actor,async()=>{
    const state=readState(actor),result=await operation(state);
    if(!result)return;
    const updated=result.state??result;
    const patch={[`flags.${ID}.state`]:JSON.stringify(updated),...(result.patch??{})};
    await actor.update(patch);return updated;
  });
}
export function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function markdown(s){
  // Source documents are displayed as escaped text; never evaluate their contents as scripts or macros.
  return escapeHTML(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').split(/\n\s*\n/).map(p=>`<p>${p.replaceAll('\n','<br>')}</p>`).join('');
}
const sourceLabel=/^(?:第三方出处|资料来源|来源|出处)(?=\s|\]|[:：]|$)/;
function normalizeBurnField(text,talent){
  return text.replace(/(^|[；;]|<p\b[^>]*>|<br\s*\/?>)([ \t]*)超载[ \t]*[:：][ \t]*([-—–－−]|[\d０-９]+|特殊|见正文|见下)(?=[ \t]*(?:[；;]|<|$))/m,
    (_,before,space,value)=>`${before}${space}超载：${burnLabel(talent,value)}`);
}

export function talentDescription(talent){
  const body=talent.body.split(/\r?\n/).filter(line=>!sourceLabel.test(line.trim().replace(/^\[/,''))).join('\n').trim();
  return markdown(normalizeBurnField(body,talent));
}

export async function cleanImportedTalentDescriptions(actor,catalog=[]){
  const updates=[];
  for(const item of actor.items){
    const id=item.getFlag(ID,'talentId');
    if(!id)continue;
    const description=item.system.description?.value;
    if(typeof description!=='string')continue;
    let cleaned=description.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi,(paragraph,inner)=>{
      return sourceLabel.test(inner.replace(/<[^>]*>/g,'').trim())?'':paragraph;
    });
    const talent=catalog.find(entry=>entry.id===id);
    if(talent)cleaned=normalizeBurnField(cleaned,talent);
    if(cleaned!==description)updates.push({_id:item.id,'system.description.value':cleaned});
  }
  if(updates.length)await actor.updateEmbeddedDocuments('Item',updates);
}
export async function ensureSpellbook(actor){
  return serializeActor(actor,async()=>{
    const state=readState(actor),books=actor.system.attributes?.spells?.spellbooks;
    assert(books,'未找到 PF1 法术书结构，可使用独立面板');
    if(state.bookKey&&books[state.bookKey]?.inUse){
      checkBook(actor,state.bookKey,books[state.bookKey]);
      return state.bookKey;
    }
    assert(Object.values(books).some(b=>!b.inUse),'现有法术书已占满，请为熵术士留出独立法术书');
    assert(typeof actor.createSpellbook==='function','当前系统未提供 createSpellbook 接口');
    const stats=actorStats(actor,state),cls=actor.items.get(stats.classId);
    const classTag=cls?.system.tag??'kineticist';
    // PF1 refuses a second book when asked to look up an already active class.
    const hasClassBook=Object.values(books).some(b=>b.inUse&&b.class===classTag);
    const proposal=await actor.createSpellbook({type:'prepared',ability:'con',spells:'psychic',class:hasClassBook?undefined:classTag,progression:'high',cantrips:false,domain:0},{commit:false});
    assert(proposal&&typeof proposal==='object'&&proposal!==actor,'法术书预览接口返回值不符，已停止自动接入');
    const bookPath='system.attributes.spells.spellbooks';
    const changes=proposal.system?.attributes?.spells?.spellbooks??{};
    const key=Object.keys(books).find(k=>!books[k]?.inUse&&(proposal[`${bookPath}.${k}`]??changes[k])?.inUse);
    assert(key,'未能找到空闲的新法术书');
    checkBook(actor,key,books[key],false);
    const book=proposal[`${bookPath}.${key}`]??changes[key];
    const slots=capacities(actor,state);
    const fields=Object.fromEntries(Object.entries(book).map(([property,value])=>[`${bookPath}.${key}.${property}`,value]));
    await actor.update({
      ...fields,
      [`${bookPath}.${key}.class`]:classTag,
      [`${bookPath}.${key}.name`]:'熵术士原力',
      ...bookProjection(key,slots),
      [`flags.${ID}.state`]:JSON.stringify({...state,bookKey:key})
    },{[ID]:{bookSync:true}});
    return key;
  });
}

function checkBook(actor,key,book,requireName=true){
  assert(book&&(!requireName||book.name==='熵术士原力'),'该法术书已被重新配置，请保留现有法术书并核对熵术士绑定');
  // PF1 11.11's template provides rank records without a base value until one is set.
  for(let rank=0;rank<=9;rank++){
    const level=book.spells?.[`spell${rank}`];
    assert(level&&typeof level==='object'&&!Array.isArray(level),'PF1 法术书缺少环级结构');
  }
  const foreign=Array.from(actor.items).some(item=>item.type==='spell'&&item.system.spellbook===key&&!item.getFlag(ID,'talentId'));
  assert(!foreign,'该法术书含有其他法术，请先为熵术士留出独立法术书');
}

function bookProjection(key,slots){
  const path=`system.attributes.spells.spellbooks.${key}`;
  const patch={[`${path}.autoSpellLevelCalculation`]:false,[`${path}.autoSpellLevels`]:false,[`${path}.spellPreparationMode`]:'prepared',[`${path}.ability`]:'con',[`${path}.domainSlotValue`]:0,[`${path}.spellPoints.useSystem`]:false};
  for(let rank=0;rank<=9;rank++)patch[`${path}.spells.spell${rank}.base`]=slots[rank]??0;
  return patch;
}

export async function syncSpellbook(actor,catalog){
  if(!actor?.isOwner||!actor.getFlag(ID,'state'))return;
  return serializeActor(actor,async()=>{
    const state=readState(actor),key=state.bookKey;
    if(!key)return;
    const book=actor.system.attributes?.spells?.spellbooks?.[key];
    if(!book?.inUse)return;
    checkBook(actor,key,book);
    const slots=capacities(actor,state);
    const activeState=activePreparation(state,slots);
    const bookPatch=bookProjection(key,slots);
    const prefix=`system.attributes.spells.spellbooks.${key}.`;
    const changed=Object.fromEntries(Object.entries(bookPatch).filter(([path,value])=>path.slice(prefix.length).split('.').reduce((parent,part)=>parent?.[part],book)!==value));
    const updates=[];
    for(const item of actor.items){
      const talent=catalog.find(t=>t.id===item.getFlag(ID,'talentId'));
      if(item.type!=='spell'||!talent)continue;
      const exempt=talent.exempt||['blast','composite','defense'].includes(talent.kind);
      const prepared=activeState.prepared[talent.id]??(activeState.temporary?.id===talent.id?activeState.temporary.slot:null);
      const active=!exempt&&state.heirloom&&slots[prepared]>0;
      const rank=active?prepared:talent.level??0;
      const count=active?1:0;
      const data=item.system;
      if(data.spellbook===key&&data.level===rank&&data.atWill===exempt&&data.slotCost===1&&!data.domain&&data.preparation?.max===count&&data.preparation?.value===count)continue;
      updates.push({_id:item.id,'system.spellbook':key,'system.level':rank,'system.atWill':exempt,'system.slotCost':1,'system.domain':false,'system.preparation.max':count,'system.preparation.value':count});
    }
    const context={[ID]:{bookSync:true}};
    if(Object.keys(changed).length)await actor.update(changed,context);
    if(updates.length)await actor.updateEmbeddedDocuments('Item',updates,context);
  });
}

export function makeSpell(talent,bookKey){
  const atWill=!bookKey||talent.exempt||['blast','composite','defense'].includes(talent.kind);
  return {name:talent.name,type:'spell',img:'icons/magic/symbols/elements-air-earth-fire-water.webp',system:{description:{value:talentDescription(talent)},level:talent.level??0,school:'evo',spellbook:bookKey??'spelllike',atWill,preparation:{value:0,max:0},actions:[{_id:foundry.utils.randomID(),name:'调用原力',actionType:'other',activation:{type:'standard',cost:1},save:{type:'',dc:''}}]},flags:{[ID]:{talentId:talent.id,sourceVersion:1}}};
}
