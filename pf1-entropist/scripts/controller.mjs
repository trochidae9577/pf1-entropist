import {ID,activePreparation,bufferCapacity,FEAT,ELEMENTS,arrayElements,integer,assert,availableLevel,makeDaily,calculateDC,canPrepare,useSpontaneous,baseBurn,burnCost,matchPrerequisites,talentNames} from './rules.mjs';
import {readState,actorStats,featCounts,capacities,serializeActor,transact,makeSpell,ensureSpellbook,syncSpellbook,markdown,talentDescription,escapeHTML as e} from './adapter.mjs';
import {linkInfusionBases,normalizedElements,availablePowers,blastKind,favoredElements,grantedBlasts,infusionAvailability,matchesInfusion,simpleBlasts} from './powers.mjs';
import {saveControls,saveType,targetSnapshots,utilitySave} from './saves.mjs';
import {boostBases,compositeProfile,profileLabel} from './composites.mjs';
import {learningAccount,learningRecord} from './learning.mjs';
import {clearBurn} from './rest.mjs';
import {renderPanel,updateArrayFields} from './view.mjs';
import {blastCost,costSummary,gatherActions,gatherLimit,masterOptions} from './blast-cost.mjs';
export function ask(title,body,label='确认',onRender){
  return new Promise(resolve=>{let settled=false;const finish=v=>{if(!settled){settled=true;resolve(v);}};
    new Dialog({title,content:`<form class="entropist-dialog">${body}</form>`,render:html=>onRender?.((html[0]??html).querySelector('form')),buttons:{ok:{label,callback:html=>{const root=html[0]??html;finish(Object.fromEntries(new FormData(root.querySelector('form'))));}},cancel:{label:'取消',callback:()=>finish(null)}},default:'ok',close:()=>finish(null)},{width:520}).render(true);
  });
}
const notify=message=>globalThis.ui?.notifications?.error(message);
const choices=talents=>talents.map(t=>`<option value="${e(t.id)}">${e(t.name)}${t.en?` · ${e(t.en)}`:''}</option>`).join('');
function infusionSummary({limit,raw,discount,net}){
  return raw===null?`注能熟稔上限 ${limit} 点。注能费用按正文裁定，请在实际超载覆盖值中填入减免后的整次念袭费用。`
    :`注能熟稔上限 ${limit} 点。注能合计 ${raw} − 熟稔减免 ${discount} ＝ 注能实付 ${net} 点。`;
}
function bufferPicker(state,level){return bufferCapacity(level)>0&&(state.buffer??0)>0?'<label><input type="checkbox" name="buffer">使用 1 点储念器抵付超载</label>':'';}
function burnUpdate(actor,state,stats,amount,buffer=0){
  if(buffer){
    assert(buffer===1&&stats.level>=6&&state.buffer>=1,'储念器没有可用点数');
    state={...state,buffer:state.buffer-1};
  }
  const immunity=actor.system.traits?.di?.value;
  if(amount>0)assert(!(Array.isArray(immunity)?immunity.includes('nonlethal'):immunity?.has?.('nonlethal')),'免疫非致命伤害的角色不能承受超载');
  const combat=game.combat;
  const accepted=burnCost(state,stats,amount,{inCombat:!!combat?.started,roundKey:combat?`${combat.id}:${combat.round}`:''});
  if(!amount)return state;
  accepted.state.burnNonlethal=(state.burnNonlethal??0)+accepted.nonlethal;
  const nonlethal=Number(actor.system.attributes.hp.nonlethal??0)+accepted.nonlethal;
  return {state:accepted.state,patch:{'system.attributes.hp.nonlethal':nonlethal}};
}

export class Controller{
  constructor(catalog){this.catalog={...catalog,talents:catalog.talents.map(t=>({...t,elements:normalizedElements(t)}))};linkInfusionBases(this.catalog.talents);this.views=new Set();this.activeBlasts=new Set();}
  async syncBook(actor){
    if(this.nativeBookAvailable===false)return;
    try{await syncSpellbook(actor,this.catalog.talents);}
    catch(error){ui.notifications.warn(`法术书同步：${error.message}`);}
  }
  model(actor){
    const state=readState(actor),stats=actorStats(actor,state),feats=featCounts(actor);let slots={},error='';
    try{slots=capacities(actor,state);}catch(err){error=err.message;}
    const items=Array.from(actor.items??[]);
    return {actor,state,stats,feats,learning:learningAccount(actor,state,stats),catalog:this.catalog,capacities:slots,error,powers:availablePowers(state,stats.level,this.catalog.talents),learned:items.map(i=>i.getFlag(ID,'talentId')).filter(Boolean),classes:items.filter(i=>i.type==='class'),attacks:items.filter(i=>['attack','weapon','feat'].includes(i.type)&&!i.getFlag(ID,'talentId')&&!i.getFlag(ID,'featId'))};
  }
  mount(root,actor){
    const view={root,actor,ui:{tab:'prepare'}};this.views.add(view);
    const render=()=>{const y=root.scrollTop;root.innerHTML=renderPanel(this.model(actor),view.ui);root.scrollTop=y;};view.render=render;
    root.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.dataset.tab){view.ui.tab=button.dataset.tab;if(button.dataset.source)view.ui.learningSource=button.dataset.source;render();return;}
      if(button.dataset.facet){
        const key=button.dataset.facet,value=button.value;
        const selected=new Set(view.ui[key]);
        if(!value)selected.clear();
        else if(selected.has(value))selected.delete(value);
        else selected.add(value);
        view.ui[key]=[...selected];
        render();
        root.querySelector(`button[data-facet="${key}"][value="${value}"]`)?.focus({preventScroll:true});
        return;
      }
      if(!button.dataset.do)return;
      event.preventDefault();button.disabled=true;
      try{await this.command(actor,button.dataset.do,button.dataset);await this.syncBook(actor);render();}catch(err){notify(err.message);button.disabled=false;}
    });
    root.addEventListener('change',async event=>{
      const el=event.target;
      if(el.dataset.filter){view.ui[el.dataset.filter]=el.type==='checkbox'?el.checked:el.value;render();return;}
      if(el.matches('[name="array"], [data-array-element]'))updateArrayFields(el.form);
      if(el.matches('[data-favored-focus]'))el.dataset.touched='true';
      if(el.dataset.prepare){try{await this.prepare(actor,el.dataset.prepare,el.value);await this.syncBook(actor);render();}catch(err){notify(err.message);render();}}
    });
    root.addEventListener('submit',async event=>{
      const form=event.target;if(!form.dataset.form)return;event.preventDefault();
      const values=Object.fromEntries(new FormData(form));
      try{
        if(form.dataset.form==='settings')await this.settings(actor,values);
        if(form.dataset.form==='favored-blasts')await transact(actor,s=>{
          const elements=favoredElements(s,actorStats(actor,s).level);
          for(const [element,id] of Object.entries(values)){
            assert(elements.includes(element)&&simpleBlasts(this.catalog.talents,element).some(t=>t.id===id),'请选择该偏好元素的简易念袭');
            assert(!s.favoredBlasts[element]||s.favoredBlasts[element]===id||game.user.isGM,'已确认的偏好念袭只能由 GM 更正');
            s.favoredBlasts[element]=id;
          }
          return s;
        });
        await this.syncBook(actor);
        render();
      }catch(err){notify(err.message);}
    });
    render();return view;
  }
  refresh(actor){for(const v of this.views)if(v.actor.uuid===actor.uuid&&v.root.isConnected)v.render();}
  talent(id){const t=this.catalog.talents.find(t=>t.id===id);assert(t,'未找到原力资料');return t;}
  owned(actor,id){return Array.from(actor.items??[]).find(i=>i.getFlag(ID,'talentId')===id);}
  prepareContext(actor,state){
    const stats=actorStats(actor,state);
    const powers=availablePowers(state,stats.level,this.catalog.talents);
    const granted=[...powers.keys()];
    const slots=capacities(actor,state);
    return {stats,state:{...activePreparation(state,slots),granted},catalog:this.catalog.talents,capacities:slots};
  }
  preparedSlot(actor,state,talent){
    assert(this.owned(actor,talent.id),'该角色未掌握此原力');
    const context=this.prepareContext(actor,state),active=context.state;
    const slot=active.prepared[talent.id]??(active.temporary?.id===talent.id?active.temporary.slot:null);
    if(!slot&&state.prepared[talent.id])throw new Error('准备位容量不足，该项暂缓；可调整准备顺序或取消其他准备');
    assert(slot,'尚未准备此原力，也未通过自发原力取得临时资格');
    canPrepare(talent,slot,context);
    return slot;
  }
  async settings(actor,values){
    return transact(actor,s=>{
      const previousArray=arrayElements(s).join('、');
      s.array=values.array;s.classId=values.classId??'';s.levelOverride=values.levelOverride===''?null:integer(values.levelOverride,1,20,'职业等级');
      if(s.array==='custom'){
        s.customArray=Array.from({length:4},(_,i)=>values[`array${i+1}`]);
      }
      const elements=arrayElements(s);
      assert(elements.length===4&&new Set(elements).size===4&&elements.every(x=>ELEMENTS.includes(x)),'请选择四种不同的组列元素');
      const stats=actorStats(actor,s);assert(stats.level>=1,'没有识别到操念使职业，请绑定职业或填入等级');
      if(stats.level>=19&&values.metaMaster!==undefined){
        assert(values.metaMaster===''||Object.hasOwn(masterOptions,values.metaMaster),'请选择有效的超念大师专精');
        s.metaMaster=values.metaMaster;
      }
      const arrayChanged=previousArray!==elements.join('、');
      const favored=[values.favored1,values.favored2].filter(Boolean);
      assert(arrayChanged||!values.favored2||values.favored1,'请先选择第一偏好专注');
      assert(favored.length<=(stats.level>=15?2:stats.level>=7?1:0),'职业等级不足以选择这些偏好专注');
      assert(new Set(favored).size===favored.length,'两种偏好专注不能相同');
      assert(favored.every(x=>arrayElements(s).includes(x)),'偏好专注必须属于位面组列');
      const previousFavored=favoredElements(s,stats.level);
      const preservesFavored=arrayChanged
        ?previousFavored.every(element=>!elements.includes(element)||favored.includes(element))
        :previousFavored.every((element,index)=>favored[index]===element);
      assert(game.user.isGM||preservesFavored,'组列中已确认的偏好专注只能由 GM 更正');
      if(arrayChanged){
        s.daily=null;s.previous=null;s.temporary=null;
        for(const talent of this.catalog.talents){
          if(s.prepared[talent.id]&&!talent.elements.some(element=>elements.includes(element)||['通用','泛用'].includes(element)))delete s.prepared[talent.id];
        }
      }
      s.favored=favored;s.binding={energy:values.energy??'',physical:values.physical??''};s.heirloom=values.heirloom==='on';
      s.extraSlots=(values.extraSlots??'').split(/[，,\s]+/).filter(Boolean).map(x=>integer(x,1,9,'额外准备位等级'));
      capacities(actor,s,(s.extraSlots??[]).join()!==(readState(actor).extraSlots??[]).join());return s;
    });
  }
  async prepare(actor,id,slot){
    const talent=this.talent(id);assert(this.owned(actor,id),'请先学习该原力');
    await transact(actor,s=>{
      if(slot===''){delete s.prepared[id];return s;}
      assert(s.heirloom,'准备原力需要同调传承物');
      canPrepare(talent,Number(slot),this.prepareContext(actor,s));
      s.prepared[id]=Number(slot);return s;
    });
  }
  async learn(actor,id,source='external'){
    const t=this.talent(id);assert(actor.isOwner,'没有角色修改权限');
    assert(t.name!=='防御扩充','熵术士不能选择防御扩充');
    assert(t.id!=='entropist-array-blast','组列念袭在 20 级由完整组列授予');
    assert(!t.incomplete,'仅索引条目不能导入为完整原力');
    if(['utility','form','substance'].includes(t.kind))assert(Number.isInteger(t.level)&&t.level>=1,'原力等级尚待核对，暂不自动导入');
    const learningState=()=>{
      const model=this.model(actor);
      const owned=this.owned(actor,id);
      assert(!owned||(source!=='external'&&!owned.getFlag(ID,'learning')),'该原力已掌握并登记');
      const record=learningRecord(source,t,model.learning);
      assert(t.elements.some(x=>arrayElements(model.state).includes(x)||['通用','泛用'].includes(x)),'原力不属于当前位面组列');
      if(t.level!==null)assert(t.level<=availableLevel(model.stats.level),'职业等级不足以学习该原力');
      const known=new Set(model.learned);
      const prerequisite=t.prerequisites?matchPrerequisites(t.prerequisites,term=>{
        const matches=this.catalog.talents.filter(entry=>entry.id!==id&&talentNames(entry).includes(term));
        if(!matches.length)return null;
        return matches.some(entry=>entry.kind==='defense'||(entry.kind==='utility'&&entry.exempt&&entry.name.startsWith('基础'))||known.has(entry.id)||model.powers.has(entry.id));
      }):true;
      assert(prerequisite!==false,`尚未满足学习先决条件（${t.prerequisites}）`);
      return {record,owned,bookKey:model.state.bookKey,prerequisite,association:infusionAvailability(t,grantedBlasts(model.powers,model.state,actor))};
    };
    const initial=learningState();
    const unmatched=initial.association?.usable===false;
    if(initial.prerequisite===null||unmatched||source==='study'){
      const condition=t.prerequisites?`<p>学习先决条件：${e(t.prerequisites)}${initial.prerequisite===null?'（请按正文核对）':''}</p>`:'';
      const association=initial.association?`<p>关联念袭：${e(initial.association.required)}</p><p>${e(initial.association.text)}。${unmatched?'可以先学习，获得匹配的念袭后再调用。':''}</p>`:'';
      const result=await ask(`学习前核对 · ${t.name}`,condition+association+(source==='study'?`<p>登记已完成的研习：${initial.record.hours} 小时、材料 ${initial.record.gold} 金币。请按桌上记录支付。</p>`:''),unmatched?'先学习，稍后使用':'已核对并学习');
      if(!result)return;
    }
    await serializeActor(actor,async()=>{
      const {bookKey,association,record,owned}=learningState();
      assert(unmatched||association?.usable!==false,'当前专注已变化，请重新核对关联念袭');
      const receipt={...record,key:foundry.utils.randomID()};
      if(owned)await actor.updateEmbeddedDocuments('Item',[{_id:owned.id,[`flags.${ID}.learning`]:receipt}]);
      else{
        const item=makeSpell(t,bookKey);
        item.flags[ID].learning=receipt;
        await actor.createEmbeddedDocuments('Item',[item]);
      }
      if(source!=='external'){
        const state=readState(actor);
        state.pastLearning=[...(state.pastLearning??[]),receipt];
        await actor.update({[`flags.${ID}.state`]:JSON.stringify(state)});
      }
    });
  }
  async daily(actor,{manual=false,reroll=false,choose=false,fullArray=false}={}){
    const current=readState(actor),stats=actorStats(actor,current);let die,roll,element,buffer=0;
    if(manual){const result=await ask('录入每日流转专注','<p>这是开始新的游戏日，不是当天免费重掷。不会自动完成睡眠或冥想。</p><label>D4 点数<input name="die" type="number" min="1" max="4" required></label>','开始新一天');if(!result)return;die=integer(result.die,1,4,'D4 点数');}
    else if(choose||fullArray){
      const elements=fullArray?ELEMENTS:arrayElements(current);
      const text=fullArray?'承受 3 点超载，可选择组列外元素并保留所有准备位。':'按照职业等级封锁相应高环准备位。';
      const result=await ask(fullArray?'完整组列':'扭转命运 · 指定元素',`<p>${text}</p>${fullArray?bufferPicker(current,stats.level):''}<select name="element">${elements.map(x=>`<option>${e(x)}</option>`).join('')}</select>`);
      if(!result)return;
      element=result.element;buffer=Number(result.buffer==='on');
    }
    else{
      if(!reroll){const result=await ask('开始新一天','<p>掷 1d4 确定新游戏日的流转专注。自发原力次数会重置；超载需要另行完成整夜休息清除。</p>','掷 D4 并开始新一天');if(!result)return;}
      else{assert(stats.level>=9,'扭转命运重掷需要 9 级');assert(current.daily&&!current.daily.bendUsed&&!current.daily.chosen,'尚未开始一天，或今天已经重掷或指定元素');}
      roll=await new Roll('1d4').evaluate();die=roll.total;
    }
    let next;
    await transact(actor,s=>{
      assert(s.heirloom,'确定流转专注需要同调传承物');
      assert(s.day===current.day&&s.daily?.element===current.daily?.element,'流转专注已经变化，请重新选择');
      const stats=actorStats(actor,s);
      next=makeDaily(s,{die,level:stats.level,mode:fullArray?'full-array':choose?'choose':reroll?'reroll':'new',element,worldTime:game.time.worldTime});
      return fullArray?burnUpdate(actor,next,stats,3-buffer,buffer):next;
    });
    const content=`<h3>流转专注 · ${e(next.daily.element)}</h3><p>第 ${next.day} 天 · ${die?`D4 = ${die}`:'指定元素'} · 封锁最高 ${next.daily.locked} 档原力位</p><p>原力 DC 和施法者等级已按当前属性、专长及偏好专注更新。请在熵术士面板查看。</p>`;
    if(roll)await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:content});else await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content});
  }
  async dailyBlast(actor){
    const {state,stats}=this.model(actor);
    const daily=state.daily;
    assert(state.heirloom&&daily,'请持有同调传承物并确定流转专注');
    const candidates=simpleBlasts(this.catalog.talents,daily.element);
    assert(candidates.length>1&&!candidates.some(t=>t.id===daily.blastId)&&!favoredElements(state,stats.level).includes(daily.element),'当前无需选择流转念袭');
    const result=await ask('选择当日简易念袭',`<p>${e(daily.element)}元素。本次确认后可用到下个游戏日或流转专注改变。</p><label>简易念袭<select name="blast">${choices(candidates)}</select></label>`,'确认当日念袭');
    if(!result)return;
    assert(candidates.some(t=>t.id===result.blast),'简易念袭不属于当日元素');
    return transact(actor,current=>{
      assert(current.heirloom&&current.day===state.day&&current.daily?.element===daily.element&&!candidates.some(t=>t.id===current.daily.blastId),'当日专注或念袭已经变化，请刷新');
      assert(!favoredElements(current,actorStats(actor,current).level).includes(daily.element),'专注重合，已可使用两种简易念袭');
      current.daily.blastId=result.blast;
      return current;
    });
  }
  async useTalent(actor,id){
    const t=this.talent(id);
    assert(actor.isOwner,'没有调用该角色的权限');
    assert(!t.incomplete,'原力正文尚未补齐');
    if(['blast','composite'].includes(t.kind)){
      return this.blast(actor,blastKind(t),{blastId:id});
    }
    const state=readState(actor);
    const initialGrant=availablePowers(state,actorStats(actor,state).level,this.catalog.talents).get(id);
    if(!initialGrant){
      assert(!t.exempt,'当前专注没有授予这项原力');
      assert(state.daily&&state.heirloom,'请持有同调传承物并确定流转专注');
      this.preparedSlot(actor,state,t);
    }
    if(['form','substance'].includes(t.kind))return this.blast(actor,null,{infusionId:id});
    const defaultBurn=baseBurn(t);
    const result=await ask(`调用 ${t.name}`,`<label>本次元素<select name="element"><option value="">按原力默认元素</option>${t.elements.map(x=>`<option>${e(x)}</option>`).join('')}</select></label><label>其他 DC 修正<input type="number" name="other" value="0"></label><label>本次实际承受超载<input type="number" name="burn" min="0" value="${defaultBurn??''}" ${defaultBurn===null?'placeholder="按正文填写"':''}></label>${bufferPicker(state,actorStats(actor,state).level)}`,'发送规则卡');
    if(!result)return;
    const amount=result.burn?.trim()?integer(result.burn,0,99,'实际超载'):defaultBurn;
    assert(amount!==null,'超载取决于原力正文，请填写本角色本次实际承受的超载');
    let dc,slot,enhancement;
    await transact(actor,current=>{
      const stats=actorStats(actor,current);
      const grant=availablePowers(current,stats.level,this.catalog.talents).get(id);
      assert(grant||(!t.exempt&&current.daily&&current.heirloom),'当前不具备调用资格');
      slot=grant?null:this.preparedSlot(actor,current,t);
      enhancement=grant?.defenseEnhancement??0;
      const effectiveStats=grant?{...stats,level:grant.effectiveLevel}:stats;
      dc=calculateDC({talent:t,stats:effectiveStats,state:current,focusLevel:stats.level,slot,adaptive:!!featCounts(actor).adaptive,selectedElement:result.element||undefined,other:Number(result.other)});
      const buffered=Number(amount>0&&result.buffer==='on');
      return burnUpdate(actor,current,stats,amount-buffered,buffered);
    });
    const save=utilitySave(t,dc.dc);
    const targets=save?targetSnapshots(game.user.targets):[];
    const controls=save?saveControls([save],targets,'确认适用目标后投掷豁免。'):t.kind==='utility'&&t.save&&!/^(?:无|否)$/.test(t.save.trim())?'<p>豁免按正文结算。</p>':'';
    const buffered=Number(amount>0&&result.buffer==='on');
    const card={speaker:ChatMessage.getSpeaker({actor}),content:`<div class="entropist-card"><h3>${e(t.name)}</h3><p>本次超载 ${amount-buffered}${buffered?' · 储念器抵付 1 点':''}</p><p><b>基准 DC ${dc.dc}</b> · 施法者等级 ${dc.cl}</p><p>${e(dc.formula)}</p><p>豁免 ${e(t.save||'按正文')}</p>${controls}${enhancement?`<p>护身强化视同已承受 ${enhancement} 点超载。</p>`:''}${talentDescription(t)}</div>`,flags:{[ID]:{talentId:id,dc,saveType:save?saveType(save.save):null,slot,version:1,...(save?{defense:{saves:[save],targets}}:{})}}};
    if(ChatMessage.implementation?.applyRollMode&&game.settings?.get)ChatMessage.implementation.applyRollMode(card,game.settings.get('core','rollMode'));
    await ChatMessage.create(card);
  }
  availableInfusions(actor,state,blast,base){
    if(!state.heirloom)return [];
    const ids=new Set([...Object.keys(state.prepared),state.temporary?.id]);
    return this.catalog.talents.filter(talent=>{
      if(!ids.has(talent.id)||!['form','substance'].includes(talent.kind)||!(matchesInfusion(talent,blast)||(base&&matchesInfusion(talent,base))))return false;
      try{this.preparedSlot(actor,state,talent);return true;}catch{return false;}
    });
  }
  async blast(actor,kind,selection={}){
    assert(actor.isOwner,'没有调用该角色的权限');
    const key=actor.uuid??actor.id;
    assert(!this.activeBlasts.has(key),'该角色已有一次念袭正在处理');
    this.activeBlasts.add(key);
    try{return await this.resolveBlast(actor,kind,selection);}
    finally{this.activeBlasts.delete(key);}
  }
  async resolveBlast(actor,kind,{blastId,infusionId}={}){
    const state=readState(actor),stats=actorStats(actor,state);
    const powers=availablePowers(state,stats.level,this.catalog.talents);
    const required=infusionId?this.talent(infusionId):null;
    const available=grantedBlasts(powers,state,actor);
    const blasts=available.filter(talent=>{
      if(blastId&&talent.id!==blastId)return false;
      if(kind&&blastKind(talent)&&blastKind(talent)!==kind)return false;
      return !required||matchesInfusion(required,talent)||boostBases(talent,available,stats.level).some(b=>matchesInfusion(required,b));
    });
    assert(blasts.length,required?`${required.name}需要关联念袭：${required.associated||'见正文'}。当前念袭：${available.map(t=>t.name).join('、')||'无'}。`:'当前没有符合条件的念袭，请核对专注、简易念袭选择和念袭类型');
    if(!blastId&&blasts.length>1){
      const selection=await ask('选择本次念袭',`<label>念袭<select name="blast">${choices(blasts)}</select></label>`,'选择注能');
      if(!selection)return;
      blastId=selection.blast;
    }
    const blast=blasts.find(t=>t.id===blastId)??blasts[0];
    const grant=powers.get(blast.id);
    const profile=await compositeProfile(blast,available,state,{...stats,level:grant.effectiveLevel},this.catalog.talents,ask,b=>(!required||matchesInfusion(required,blast)||matchesInfusion(required,b))&&(!kind||!blastKind(b)||blastKind(b)===kind));
    if(blast.kind==='composite'&&!profile)return;
    const pricedBlast=profile?.extra?{...blast,burn:baseBurn(blast)+profile.extra}:blast;
    const base=available.find(b=>b.id===profile?.baseId);
    const eligible=this.availableInfusions(actor,state,blast,base);
    if(required)assert(eligible.some(t=>t.id===required.id),'所选注能已失去准备资格');
    const empty=eligible.find(t=>t.en==='Empty Infusion');
    const form=eligible.filter(t=>t.kind==='form');
    const substance=eligible.filter(t=>t.kind==='substance'&&t!==empty);
    const picker=(list,name,label)=>{
      if(required&&list.includes(required))return `<input type="hidden" name="${name}" value="${e(required.id)}"><p>${label} ${e(required.name)}</p>`;
      return `<label>${label}<select name="${name}"><option value="">无</option>${choices(list)}</select></label>`;
    };
    const knownKind=profile?.kind??blastKind(blast)??kind;
    const kindPicker=knownKind?'':'<label>原 PF 念袭动作<select name="kind"><option value="energy">能量念袭</option><option value="physical">物理念袭</option></select></label>';
    const focusElements=[...new Set(eligible.flatMap(t=>t.elements))];
    const focusPicker=focusElements.length>1?`<label>多元素注能的本次元素<select name="element"><option value="">按各注能自动判断</option>${focusElements.map(element=>`<option>${e(element)}</option>`).join('')}</select></label>`:'';
    const emptyPicker=empty?(required===empty?'<input type="hidden" name="empty" value="on">':'<label><input name="empty" type="checkbox">附加空击注能</label>'):'';
    const halfPicker=substance.some(t=>t.en.toLowerCase()==='dazzling infusion')?'<label><input name="halfDamage" type="checkbox">炫目注能伤害减半，DC +2</label>':'';
    const metaPicker=`<fieldset><legend>超念</legend>
      <label><input name="empower" type="checkbox" ${stats.level<5?'disabled':''}>强效（5 级，+1 超载）</label>
      <label><input name="maximize" type="checkbox" ${stats.level<9?'disabled':''}>极效（9 级，+2 超载）</label><label><input name="quicken" type="checkbox" ${stats.level<13?'disabled':''}>瞬发（13 级，迅捷动作，+3 超载）</label></fieldset>`;
    const gatherPicker=`<label>念力凝聚${stats.level>=11?'（超聚合）':''}<select name="gather">${Object.entries(gatherActions).map(([key,label])=>`<option value="${key}">${label}（最多减 ${gatherLimit(stats.level,key)} 点）</option>`).join('')}</select></label><small>选择已完成的动作。凝聚需要双手空闲。释放前受伤，手动进行专注检定（DC＝10＋所受伤害＋念袭有效法术等级）；失败则取消念袭，并手动记录本次凝聚原可减免的超载。</small>`;
    const idsFor=values=>[...new Set([values.form,values.substance,values.empty==='on'?empty?.id:null].filter(Boolean))];
    const preview=formEl=>{
      const update=()=>{
        const values=Object.fromEntries(new FormData(formEl));
        const ids=idsFor(values);
        const selected=eligible.filter(t=>ids.includes(t.id));
        const output=formEl.querySelector('[data-blast-cost]');
        try{
          const cost=blastCost(pricedBlast,selected,stats.level,state.metaMaster,values);
          formEl.querySelector('[data-infusion-cost]').textContent=infusionSummary(cost.infusion);
          output.textContent=costSummary(cost,stats.level);
        }catch(error){output.textContent=error.message;}
      };
      formEl.addEventListener('input',update);
      formEl.addEventListener('change',update);
      update();
    };
    const input=await ask(blast.name,`<p>有效职业等级 ${grant.effectiveLevel}。攻击由已绑定的 PF1 动作执行，注能效果和伤害调整以组合卡为准。</p>${profile?`<p>${e(profile.baseName??blast.name)} · ${e(profileLabel(profile))}</p>`:''}${kindPicker}${picker(form,'form','塑形注能')}${picker(substance,'substance','性质注能')}${emptyPicker}<p data-infusion-cost aria-live="polite"></p>${halfPicker}${focusPicker}${metaPicker}${gatherPicker}${bufferPicker(state,stats.level)}<label>其他超载减免<input name="reduction" type="number" min="0" value="0"></label><label>实际超载覆盖值（留空自动）<input name="burn" type="number" min="0"></label><p data-blast-cost aria-live="polite"></p>`,'打开原 PF 念袭',preview);
    if(!input)return;
    const current=readState(actor),currentStats=actorStats(actor,current);
    const currentGrant=availablePowers(current,currentStats.level,this.catalog.talents).get(blast.id);
    assert(currentGrant,'该念袭已经失去使用资格');
    if(profile){
      assert(stats.level===currentStats.level&&grant.effectiveLevel===currentGrant.effectiveLevel&&stats.conMod===currentStats.conMod&&arrayElements(current).join()===arrayElements(state).join(),'角色或组列已变化，请重新调用');
      if(profile.baseId)assert(availablePowers(current,currentStats.level,this.catalog.talents).has(profile.baseId),'基础念袭已失去使用资格');
    }
    const currentBlasts=grantedBlasts(availablePowers(current,currentStats.level,this.catalog.talents),current,actor);
    const allowed=this.availableInfusions(actor,current,currentBlasts.find(b=>b.id===blast.id),currentBlasts.find(b=>b.id===base?.id));
    const infusions=idsFor(input).map(id=>{
      const talent=allowed.find(t=>t.id===id);
      assert(talent,'所选注能已失效或不适用于该念袭');
      return talent;
    });
    const hasEmpty=infusions.some(t=>t.en==='Empty Infusion');
    const hasDazzling=infusions.some(t=>t.en.toLowerCase()==='dazzling infusion');
    const halfDamage=input.halfDamage==='on'&&hasDazzling;
    const hasSoundIntensity=blast.elements.includes('音')&&this.catalog.talents.some(t=>{
      if(t.name!=='音之强度'||!current.heirloom)return false;
      try{this.preparedSlot(actor,current,t);return true;}catch{return false;}
    });
    const level=currentGrant.effectiveLevel;
    const commonDC=(hasEmpty?1+Number(level>=7)+Number(level>=15):0)+Number(hasSoundIntensity);
    const saves=infusions.filter(t=>t.save&&!/^无\s*$/.test(t.save)).map(t=>{
      const selectedElement=t.elements.includes(input.element)?input.element:undefined;
      const other=commonDC+(halfDamage&&t.en.toLowerCase()==='dazzling infusion'?2:0);
      const dc=calculateDC({talent:t,stats:{...currentStats,level},state:current,focusLevel:currentStats.level,selectedElement,other});
      return {id:t.id,name:t.name,kind:t.kind,save:t.save,...dc};
    });
    const cost=blastCost(pricedBlast,infusions,currentStats.level,current.metaMaster,input);
    const {meta,metaCost,amount}=cost;
    assert(amount!==null,'超载取决于原力正文，请填写实际超载');
    burnUpdate(actor,current,currentStats,amount,cost.buffer);
    const item=actor.items.get(current.binding[knownKind??input.kind]);
    assert(item&&typeof item.use==='function','请先在熵术士设置中绑定原 PF 念袭条目');
    const selectedTargets=targetSnapshots(game.user.targets);
    const chronoLevel=blast.en==='Chrono Blast'?level:0;
    const special=metaCost||chronoLevel||profile||hasEmpty||halfDamage;
    const used=special?await item.use({options:{[ID]:{...meta,chronoLevel,profile,zero:hasEmpty,half:halfDamage}}}):await item.use();
    if(!used||used.err||used.reject||used.shared?.reject)return;
    if(amount||cost.buffer)await transact(actor,s=>burnUpdate(actor,s,actorStats(actor,s),amount,cost.buffer));
    const saveDetails=saves.map(save=>`<p><b>${e(save.name)} · DC ${save.dc}</b> · ${e(save.save)}</p><p>${e(save.formula)}</p>`).join('');
    const notes=[hasEmpty?'空击注能令本次伤害为 0。':null,halfDamage?'炫目注能令本次伤害减半。':null,level!==currentStats.level?`传承物缺失，按 ${level} 级结算念袭效果。`:null].filter(Boolean);
    const targets=used.shared?.targets?targetSnapshots(used.shared.targets):selectedTargets;
    if(profile)notes.push(`${profile.baseName??blast.name} · ${profileLabel(profile)}`);
    for(const [i,attack] of (used.shared?.chatAttacks??[]).entries()){
      const rolls=attack.damage?.rolls??[];
      const nonlethal=rolls.filter(r=>Array.from(r.options?.damageType??[]).includes('nonlethal')).reduce((sum,r)=>sum+r.total,0);
      if(nonlethal)notes.push(`第 ${i+1} 次命中：致命伤害 ${attack.damage.total-nonlethal} 点，非致命伤害 ${nonlethal} 点。`);
    }
    if(chronoLevel)notes.push(`时流念袭基础伤害：${Math.ceil(chronoLevel/2)}d4 ＋ 半数体质调整值（无类型）。`);
    if(metaCost)notes.unshift(`超念：${[meta.empower?'强效':'',meta.maximize?'极效':'',meta.quicken?'瞬发（迅捷动作）':''].filter(Boolean).join('＋')}（减免前 +${metaCost} 超载）。`);
    if(infusions.length){
      const fees=cost.infusion;
      notes.unshift(fees.raw===null?`注能熟稔上限 ${fees.limit} 点，注能费用按正文裁定。`:infusionSummary(fees));

    }
    notes.push(costSummary(cost,currentStats.level));
    const parent=used.shared?.message??used.message;
    const card={speaker:ChatMessage.getSpeaker({actor}),content:`<div class="entropist-card"><h3>${e(blast.name)}</h3><p>有效职业等级 ${level} · 本次超载 ${amount}</p>${saveDetails}${saveControls(saves,targets)}${notes.map(note=>`<p>${e(note)}</p>`).join('')}${[blast,...infusions].map(t=>`<h4>${e(t.name)}</h4>${talentDescription(t)}`).join('')}</div>`,flags:{[ID]:{blastId:blast.id,infusions:infusions.map(t=>t.id),saves,amount,cost,defense:{saves,targets}}}};
    if(parent){
      card.whisper=[...(parent.whisper??[])];
      card.blind=!!parent.blind;
    }else if(ChatMessage.implementation?.applyRollMode&&game.settings?.get){
      ChatMessage.implementation.applyRollMode(card,used.shared?.rollMode??game.settings.get('core','rollMode'));
    }
    await ChatMessage.create(card);
  }
  async command(actor,command,data={}){
    const id=data.id;
    if(command==='refresh')return;
    if(command==='detail'){const t=this.talent(id);new Dialog({title:t.name,content:talentDescription(t),buttons:{close:{label:'关闭'}}},{width:700}).render(true);return;}
    assert(actor.isOwner,'没有角色修改权限');
    if(command==='learn')return this.learn(actor,id,data.source);
    if(command==='cast')return this.useTalent(actor,id);
    if(command==='blast')return this.blast(actor,data.kind);
    if(command==='daily')return this.daily(actor);
    if(command==='manual')return this.daily(actor,{manual:true});
    if(command==='daily-blast')return this.dailyBlast(actor);
    if(command==='reroll')return this.daily(actor,{reroll:true});
    if(command==='choose')return this.daily(actor,{choose:true});
    if(command==='full-array')return this.daily(actor,{fullArray:true});
    if(command==='grant')return transact(actor,s=>{s.granted=(s.granted??[]).includes(id)?s.granted.filter(x=>x!==id):[...(s.granted??[]),id];return s;});
    if(command==='forget'){
      const t=this.talent(id),answer=await ask('移除已掌握原力',`<p>移除本模组导入的“${e(t.name)}”及其准备记录，原力资料库仍保留正文。</p>`,'移除');if(!answer)return;
      const item=this.owned(actor,id),receipt=item?.getFlag(ID,'learning');
      if(receipt&&receipt.source!=='external')await transact(actor,s=>{s.pastLearning=[...(s.pastLearning??[]).filter(r=>r.key!==receipt.key),receipt];return s;});
      if(item)await actor.deleteEmbeddedDocuments('Item',[item.id]);
      return transact(actor,s=>{delete s.prepared[id];s.granted=(s.granted??[]).filter(x=>x!==id);if(s.temporary?.id===id)s.temporary=null;return s;});
    }
    if(command==='feat'){
      const f=this.catalog.feats.find(f=>f.id===id);assert(f,'未知专长');const stats=actorStats(actor),counts=featCounts(actor);
      if(id===FEAT.extra)assert(stats.level>=5&&stats.constitution>=17,'需要熵术士 5 级、体质 17');
      if(id===FEAT.spontaneous){assert(stats.level>=5,'需要熵术士 5 级');assert(!counts.spontaneous,'已经取得自发原力');}
      if(id===FEAT.adaptive)assert(!counts.adaptive,'已经取得适应性通用原力');
      return actor.createEmbeddedDocuments('Item',[{name:f.name,type:'feat',img:'icons/magic/symbols/runes-carved-stone-green.webp',system:{description:{value:markdown(f.body)},featType:'feat'},flags:{[ID]:{featId:id}}}]);
    }
    if(command==='book'){
      assert(this.nativeBookAvailable!==false,'当前 PF1 接口未接入原力施放，请使用熵术士面板');
      await ensureSpellbook(actor);
      await syncSpellbook(actor,this.catalog.talents);
      ui.notifications.info('已同步体质准备法术书');return;
    }
    if(command==='feature'){
      if(Array.from(actor.items).some(i=>i.getFlag(ID,'archetype')))return;
      return actor.createEmbeddedDocuments('Item',[{name:'熵术士',type:'feat',system:{description:{value:markdown(this.catalog.archetype)},featType:'classFeat'},flags:{[ID]:{archetype:true}}}]);
    }
    if(command==='spontaneous'){
      assert(featCounts(actor).spontaneous,'尚未取得自发原力');const t=this.talent(id);assert(this.owned(actor,id),'尚未学习原力');
      const input=await ask('自发原力','<label>填入空置的原力位等级<input name="slot" type="number" min="1" max="9" required></label>');if(!input)return;
      return transact(actor,s=>{
        assert(s.daily&&s.heirloom,'自发原力需要当日专注和同调传承物');
        const context=this.prepareContext(actor,s);
        const next=useSpontaneous(context.state,{...context,talent:t,slot:Number(input.slot),time:game.time.worldTime});
        next.granted=s.granted??[];next.prepared=s.prepared;
        return next;
      });
    }
    if(command==='charge-buffer'){
      const answer=await ask('储念器充能','<p>以整轮动作承受 1 点超载并存入储念器。储能可跨日保留。</p>','确认充能');
      if(!answer)return;
      return transact(actor,s=>{
        const stats=actorStats(actor,s),stored=s.buffer??0;
        assert(stored<bufferCapacity(stats.level),'储念器已满或等级不足');
        return burnUpdate(actor,{...s,buffer:stored+1},stats,1);
      });
    }
    if(command==='rest'){
      const recorded=readState(actor).burnNonlethal??0,hp=Number(actor.system.attributes.hp.nonlethal??0);
      const reconcile=recorded>hp;
      const field=reconcile?`<label>旧记录为 ${recorded} 点，目前共 ${hp} 点瘀伤。其中仍属于超载的点数<input name="remaining" type="number" min="0" max="${hp}" required></label>`:'';
      const result=await ask('完成整夜休息','<p>整夜休息后，移除超载及对应瘀伤，保留普通瘀伤。</p>'+field,'确认已经完成休息');if(!result)return;
      if(reconcile)assert(result.remaining?.trim(),'请填写剩余超载瘀伤');
      const remove=reconcile?integer(result.remaining,0,hp,'剩余超载瘀伤'):recorded;
      return transact(actor,s=>{
        assert((s.burnNonlethal??0)===recorded&&Number(actor.system.attributes.hp.nonlethal??0)===hp,'角色瘀伤已变化，请重新核对');
        return {state:clearBurn(s),patch:{'system.attributes.hp.nonlethal':hp-remove}};
      });
    }
    if(command==='macros'){
      for(const [name,action]of [['熵术士面板','open'],['每日流转专注','daily']]){
        const command=`const actor = await fromUuid(${JSON.stringify(actor.uuid)});\nif (actor) await game.modules.get('${ID}').api.${action}(actor);`;
        if(!Array.from(game.macros).some(m=>m.command===command))await Macro.create({name,type:'script',img:'icons/magic/symbols/elements-air-earth-fire-water.webp',command});
      }
      ui.notifications.info('已在宏目录建立角色专用快捷宏，可拖入快捷栏');return;
    }
    throw new Error('未实现的操作：'+command);
  }
}
