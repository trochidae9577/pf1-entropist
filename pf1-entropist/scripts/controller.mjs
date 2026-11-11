import {ID,FEAT,ELEMENTS,arrayElements,integer,assert,availableLevel,makeDaily,calculateDC,canPrepare,useSpontaneous,baseBurn,burnCost,matchPrerequisites,talentNames} from './rules.mjs';
import {readState,actorStats,featCounts,capacities,serializeActor,transact,makeSpell,ensureSpellbook,syncSpellbook,markdown,talentDescription,escapeHTML as e} from './adapter.mjs';
import {availablePowers,blastKind,comboBurn,favoredElements,matchesInfusion,simpleBlasts} from './powers.mjs';
import {saveControls,saveType,targetSnapshots,utilitySave} from './saves.mjs';
import {renderPanel} from './view.mjs';
export function ask(title,body,label='确认'){
  return new Promise(resolve=>{let settled=false;const finish=v=>{if(!settled){settled=true;resolve(v);}};
    new Dialog({title,content:`<form class="entropist-dialog">${body}</form>`,buttons:{ok:{label,callback:html=>{const root=html[0]??html;finish(Object.fromEntries(new FormData(root.querySelector('form'))));}},cancel:{label:'取消',callback:()=>finish(null)}},default:'ok',close:()=>finish(null)},{width:520}).render(true);
  });
}
const notify=message=>globalThis.ui?.notifications?.error(message);
const choices=talents=>talents.map(t=>`<option value="${e(t.id)}">${e(t.name)}${t.en?` · ${e(t.en)}`:''}</option>`).join('');
function burnUpdate(actor,state,stats,amount){
  const combat=game.combat;
  const accepted=burnCost(state,stats,amount,{inCombat:!!combat?.started,roundKey:combat?`${combat.id}:${combat.round}`:''});
  if(!amount)return state;
  accepted.state.burnNonlethal=(state.burnNonlethal??0)+accepted.nonlethal;
  const nonlethal=Number(actor.system.attributes.hp.nonlethal??0)+accepted.nonlethal;
  return {state:accepted.state,patch:{'system.attributes.hp.nonlethal':nonlethal}};
}

export class Controller{
  constructor(catalog){this.catalog=catalog;this.views=new Set();this.activeBlasts=new Set();}
  async syncBook(actor){
    if(this.nativeBookAvailable===false)return;
    try{await syncSpellbook(actor,this.catalog.talents);}
    catch(error){ui.notifications.warn(`法术书同步：${error.message}`);}
  }
  model(actor){
    const state=readState(actor),stats=actorStats(actor,state),feats=featCounts(actor);let slots={},error='';
    try{slots=capacities(actor,state);}catch(err){error=err.message;}
    const items=Array.from(actor.items??[]);
    return {actor,state,stats,feats,catalog:this.catalog,capacities:slots,error,powers:availablePowers(state,stats.level,this.catalog.talents),learned:items.map(i=>i.getFlag(ID,'talentId')).filter(Boolean),classes:items.filter(i=>i.type==='class'),attacks:items.filter(i=>['attack','weapon','feat'].includes(i.type)&&!i.getFlag(ID,'talentId')&&!i.getFlag(ID,'featId'))};
  }
  mount(root,actor){
    const view={root,actor,ui:{tab:'prepare'}};this.views.add(view);
    const render=()=>{const y=root.scrollTop;root.innerHTML=renderPanel(this.model(actor),view.ui);root.scrollTop=y;};view.render=render;
    root.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.dataset.tab){view.ui.tab=button.dataset.tab;render();return;}
      if(!button.dataset.do)return;
      event.preventDefault();button.disabled=true;
      try{await this.command(actor,button.dataset.do,button.dataset);await this.syncBook(actor);render();}catch(err){notify(err.message);button.disabled=false;}
    });
    root.addEventListener('change',async event=>{
      const el=event.target;
      if(el.dataset.filter){view.ui[el.dataset.filter]=el.type==='checkbox'?el.checked:el.value;render();return;}
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
    return {stats,state:{...state,granted},catalog:this.catalog.talents,capacities:capacities(actor,state)};
  }
  preparedSlot(actor,state,talent){
    assert(this.owned(actor,talent.id),'该角色未掌握此原力');
    const slot=state.prepared[talent.id]??(state.temporary?.id===talent.id?state.temporary.slot:null);
    assert(slot,'尚未准备此原力，也未通过自发原力取得临时资格');
    canPrepare(talent,slot,this.prepareContext(actor,state));
    return slot;
  }
  async settings(actor,values){
    return transact(actor,s=>{
      const previousArray=arrayElements(s).join('、');
      s.array=values.array;s.classId=values.classId??'';s.levelOverride=values.levelOverride===''?null:integer(values.levelOverride,1,20,'职业等级');
      if(s.array==='custom'&&game.user.isGM){
        s.customArray=Array.from({length:4},(_,i)=>values[`array${i+1}`]);
      }
      const elements=arrayElements(s);
      assert(elements.length===4&&new Set(elements).size===4&&elements.every(x=>ELEMENTS.includes(x)),'请选择四种不同的组列元素');
      const stats=actorStats(actor,s);assert(stats.level>=1,'没有识别到操念使职业，请绑定职业或填入等级');
      const favored=[values.favored1,values.favored2].filter(Boolean);
      assert(!values.favored2||values.favored1,'请先选择第一偏好专注');
      assert(favored.length<=(stats.level>=15?2:stats.level>=7?1:0),'职业等级不足以选择这些偏好专注');
      assert(new Set(favored).size===favored.length,'两种偏好专注不能相同');
      assert(favored.every(x=>arrayElements(s).includes(x)),'偏好专注必须属于位面组列');
      assert(game.user.isGM||favoredElements(s,stats.level).every((element,index)=>favored[index]===element),'已确认的偏好专注只能由 GM 更正');
      if(previousArray!==elements.join('、')&&s.daily){
        assert(game.user.isGM,'当日专注已经确定，组列变更需要 GM 操作');
        s.daily=null;s.previous=null;s.temporary=null;
      }
      s.favored=favored;s.binding={energy:values.energy??'',physical:values.physical??''};s.heirloom=values.heirloom==='on';
      s.extraSlots=(values.extraSlots??'').split(/[，,\s]+/).filter(Boolean).map(x=>integer(x,1,9,'额外准备位等级'));
      capacities(actor,s);return s;
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
  async learn(actor,id){
    const t=this.talent(id);assert(actor.isOwner,'没有角色修改权限');
    assert(t.name!=='防御扩充','熵术士不能选择防御扩充');
    assert(t.id!=='entropist-array-blast','组列念袭在 20 级由完整组列授予');
    assert(!t.incomplete,'仅索引条目不能导入为完整原力');
    if(['utility','form','substance'].includes(t.kind))assert(Number.isInteger(t.level)&&t.level>=1,'原力等级尚待核对，暂不自动导入');
    const learningState=()=>{
      const model=this.model(actor);
      assert(!model.learned.includes(id),'已经掌握该版本的原力');
      assert(t.elements.some(x=>arrayElements(model.state).includes(x)||['通用','泛用'].includes(x)),'原力不属于当前位面组列');
      if(t.level!==null)assert(t.level<=availableLevel(model.stats.level),'职业等级不足以学习该原力');
      const known=new Set(model.learned);
      const prerequisite=t.prerequisites?matchPrerequisites(t.prerequisites,term=>{
        const matches=this.catalog.talents.filter(entry=>entry.id!==id&&talentNames(entry).includes(term));
        if(!matches.length)return null;
        return matches.some(entry=>entry.kind==='defense'||(entry.kind==='utility'&&entry.exempt&&entry.name.startsWith('基础'))||known.has(entry.id)||model.powers.has(entry.id));
      }):true;
      assert(prerequisite!==false,`尚未满足学习先决条件（${t.prerequisites}）`);
      return {bookKey:model.state.bookKey,prerequisite};
    };
    if(learningState().prerequisite===null){
      const result=await ask('核对学习先决条件',`<p>请按规则核对无法自动识别的条件。</p><p>${e(t.prerequisites)}</p>`,'已核对并学习');
      if(!result)return;
    }
    await serializeActor(actor,async()=>{
      const {bookKey}=learningState();
      await actor.createEmbeddedDocuments('Item',[makeSpell(t,bookKey)]);
    });
  }
  async daily(actor,{manual=false,reroll=false,choose=false,fullArray=false}={}){
    const current=readState(actor),stats=actorStats(actor,current);let die,roll,element;
    if(manual){const result=await ask('录入每日流转专注','<p>这是开始新的游戏日，不是当天免费重掷。不会自动完成睡眠或冥想。</p><label>D4 点数<input name="die" type="number" min="1" max="4" required></label>','开始新一天');if(!result)return;die=integer(result.die,1,4,'D4 点数');}
    else if(choose||fullArray){
      const elements=fullArray?ELEMENTS:arrayElements(current);
      const text=fullArray?'承受 3 点超载，可选择组列外元素并保留所有准备位。':'按照职业等级封锁相应高环准备位。';
      const result=await ask(fullArray?'完整组列':'扭转命运 · 指定元素',`<p>${text}</p><select name="element">${elements.map(x=>`<option>${e(x)}</option>`).join('')}</select>`);
      if(!result)return;
      element=result.element;
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
      return fullArray?burnUpdate(actor,next,stats,3):next;
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
    const result=await ask(`调用 ${t.name}`,`<label>本次元素<select name="element"><option value="">按原力默认元素</option>${t.elements.map(x=>`<option>${e(x)}</option>`).join('')}</select></label><label>其他 DC 修正<input type="number" name="other" value="0"></label><label>本次实际承受超载<input type="number" name="burn" min="0" value="${defaultBurn??''}" ${defaultBurn===null?'placeholder="按正文填写"':''}></label>`,'发送规则卡');
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
      return burnUpdate(actor,current,stats,amount);
    });
    const save=utilitySave(t,dc.dc);
    const targets=save?targetSnapshots(game.user.targets):[];
    const controls=save?saveControls([save],targets,'确认适用目标后投掷豁免。'):t.kind==='utility'&&t.save&&!/^(?:无|否)$/.test(t.save.trim())?'<p>豁免按正文结算。</p>':'';
    const card={speaker:ChatMessage.getSpeaker({actor}),content:`<div class="entropist-card"><h3>${e(t.name)}</h3><p><b>基准 DC ${dc.dc}</b> · 施法者等级 ${dc.cl}</p><p>${e(dc.formula)}</p><p>豁免 ${e(t.save||'按正文')}</p>${controls}${enhancement?`<p>护身强化视同已承受 ${enhancement} 点超载。</p>`:''}${talentDescription(t)}</div>`,flags:{[ID]:{talentId:id,dc,saveType:save?saveType(save.save):null,slot,version:1,...(save?{defense:{saves:[save],targets}}:{})}}};
    if(ChatMessage.implementation?.applyRollMode&&game.settings?.get)ChatMessage.implementation.applyRollMode(card,game.settings.get('core','rollMode'));
    await ChatMessage.create(card);
  }
  availableInfusions(actor,state,blast){
    if(!state.heirloom)return [];
    const ids=new Set([...Object.keys(state.prepared),state.temporary?.id]);
    return this.catalog.talents.filter(talent=>{
      if(!ids.has(talent.id)||!['form','substance'].includes(talent.kind)||!matchesInfusion(talent,blast))return false;
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
    const blasts=[...powers.values()].map(({talent})=>talent.id==='entropist-array-blast'?{...talent,elements:arrayElements(state)}:talent).filter(talent=>{
      if(!['blast','composite'].includes(talent.kind))return false;
      if(blastId&&talent.id!==blastId)return false;
      if(kind&&blastKind(talent)&&blastKind(talent)!==kind)return false;
      return !required||matchesInfusion(required,talent);
    });
    assert(blasts.length,'当前没有符合条件的念袭，请核对专注、简易念袭选择和注能关联');
    if(!blastId&&blasts.length>1){
      const selection=await ask('选择本次念袭',`<label>念袭<select name="blast">${choices(blasts)}</select></label>`,'选择注能');
      if(!selection)return;
      blastId=selection.blast;
    }
    const blast=blasts.find(t=>t.id===blastId)??blasts[0];
    const grant=powers.get(blast.id);
    const eligible=this.availableInfusions(actor,state,blast);
    if(required)assert(eligible.some(t=>t.id===required.id),'所选注能已失去准备资格');
    const empty=eligible.find(t=>t.en==='Empty Infusion');
    const form=eligible.filter(t=>t.kind==='form');
    const substance=eligible.filter(t=>t.kind==='substance'&&t!==empty);
    const picker=(list,name,label)=>{
      if(required&&list.includes(required))return `<input type="hidden" name="${name}" value="${e(required.id)}"><p>${label} ${e(required.name)}</p>`;
      return `<label>${label}<select name="${name}"><option value="">无</option>${choices(list)}</select></label>`;
    };
    const knownKind=blastKind(blast)??kind;
    const kindPicker=knownKind?'':'<label>原 PF 念袭动作<select name="kind"><option value="energy">能量念袭</option><option value="physical">物理念袭</option></select></label>';
    const focusElements=[...new Set(eligible.flatMap(t=>t.elements))];
    const focusPicker=focusElements.length>1?`<label>多元素注能的本次元素<select name="element"><option value="">按各注能自动判断</option>${focusElements.map(element=>`<option>${e(element)}</option>`).join('')}</select></label>`:'';
    const emptyPicker=empty?(required===empty?'<input type="hidden" name="empty" value="on">':'<label><input name="empty" type="checkbox">附加空击注能</label>'):'';
    const halfPicker=substance.some(t=>t.en.toLowerCase()==='dazzling infusion')?'<label><input name="halfDamage" type="checkbox">炫目注能伤害减半，DC +2</label>':'';
    const input=await ask(blast.name,`<p>有效职业等级 ${grant.effectiveLevel}。攻击由已绑定的 PF1 动作执行，注能效果和伤害调整以组合卡为准。</p>${kindPicker}${picker(form,'form','塑形注能')}${picker(substance,'substance','性质注能')}${emptyPicker}${halfPicker}${focusPicker}<label>其他超载减免<input name="reduction" type="number" min="0" value="0"></label><label>实际超载覆盖值（留空自动）<input name="burn" type="number" min="0"></label>`,'打开原 PF 念袭');
    if(!input)return;
    const current=readState(actor),currentStats=actorStats(actor,current);
    const currentGrant=availablePowers(current,currentStats.level,this.catalog.talents).get(blast.id);
    assert(currentGrant,'该念袭已经失去使用资格');
    const allowed=this.availableInfusions(actor,current,blast);
    const infusions=[...new Set([input.form,input.substance,input.empty==='on'?empty?.id:null].filter(Boolean))].map(id=>{
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
    const estimated=comboBurn(blast,infusions,level);
    assert(input.burn!==''||estimated!==null,'超载取决于原力正文，请填写实际超载');
    const reduction=integer(input.reduction,0,99,'其他减免');
    const amount=input.burn===''?Math.max(0,estimated-reduction):integer(input.burn,0,99,'实际超载');
    burnUpdate(actor,current,currentStats,amount);
    const item=actor.items.get(current.binding[knownKind??input.kind]);
    assert(item&&typeof item.use==='function','请先在熵术士设置中绑定原 PF 念袭条目');
    const selectedTargets=targetSnapshots(game.user.targets);
    const used=await item.use();
    if(!used||used.err||used.reject||used.shared?.reject)return;
    if(amount)await transact(actor,s=>burnUpdate(actor,s,actorStats(actor,s),amount));
    const saveDetails=saves.map(save=>`<p><b>${e(save.name)} · DC ${save.dc}</b> · ${e(save.save)}</p><p>${e(save.formula)}</p>`).join('');
    const notes=[hasEmpty?'空击注能令本次伤害为 0。':null,halfDamage?'炫目注能令本次伤害减半。':null,level!==currentStats.level?`传承物缺失，按 ${level} 级结算念袭效果。`:null].filter(Boolean);
    const targets=used.shared?.targets?targetSnapshots(used.shared.targets):selectedTargets;
    const parent=used.shared?.message??used.message;
    const card={speaker:ChatMessage.getSpeaker({actor}),content:`<div class="entropist-card"><h3>${e(blast.name)}</h3><p>有效职业等级 ${level} · 本次超载 ${amount}</p>${saveDetails}${saveControls(saves,targets)}${notes.map(note=>`<p>${e(note)}</p>`).join('')}${[blast,...infusions].map(t=>`<h4>${e(t.name)}</h4>${talentDescription(t)}`).join('')}</div>`,flags:{[ID]:{blastId:blast.id,infusions:infusions.map(t=>t.id),saves,amount,defense:{saves,targets}}}};
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
    if(command==='learn')return this.learn(actor,id);
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
      const item=this.owned(actor,id);if(item)await actor.deleteEmbeddedDocuments('Item',[item.id]);
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
        next.granted=s.granted??[];
        return next;
      });
    }
    if(command==='rest'){
      const result=await ask('完成整夜休息','<p>仅在角色已完成整夜休息后使用：移除本模组记录的超载及对应非致命伤害。不会代替其他职业的休息恢复。</p>','确认已经完成休息');if(!result)return;
      return transact(actor,s=>{const recorded=s.burnNonlethal??0;s.burn=0;s.burnNonlethal=0;s.roundBurn=0;s.roundKey='';return {state:s,patch:{'system.attributes.hp.nonlethal':Math.max(0,Number(actor.system.attributes.hp.nonlethal??0)-recorded)}};});
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
