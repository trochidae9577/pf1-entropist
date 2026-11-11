import {ID,VERSION} from './rules.mjs';
import {Controller,ask} from './controller.mjs';
import {cleanImportedTalentDescriptions} from './adapter.mjs';
import {escapeHTML as e} from './adapter.mjs';
import {bindSaveCard} from './saves.mjs';
let controller;
const panels=new Map();
function selectedActor(){return canvas?.tokens?.controlled?.[0]?.actor??game.user.character;}
const LegacyApplication=globalThis.Application??foundry.appv1.api.Application;
class EntropistPanel extends LegacyApplication{
  constructor(actor,options={}){super({...options,id:`pf1-entropist-${actor.id}`});this.actor=actor;}
  static get defaultOptions(){return foundry.utils.mergeObject(super.defaultOptions,{id:'pf1-entropist-panel',title:'熵术士原力',template:`modules/${ID}/templates/panel.hbs`,width:1080,height:800,resizable:true,classes:['pf1-entropist-window']});}
  getData(){return {body:''};}
  activateListeners(html){super.activateListeners(html);if(this.view)controller.views.delete(this.view);this.view=controller.mount(html[0]??html,this.actor);}
  async close(options){if(this.view)controller.views.delete(this.view);panels.delete(this.actor.uuid);return super.close(options);}
}
async function open(actor=selectedActor()){
  if(!actor){const actors=Array.from(game.actors).filter(a=>a.isOwner&&a.type==='character');const data=await ask('选择熵术士角色',`<select name="actor">${actors.map(a=>`<option value="${a.id}">${e(a.name)}</option>`).join('')}</select>`);if(!data)return;actor=game.actors.get(data.actor);}
  if(!actor?.isOwner)throw new Error('请选中自己有权限控制的角色');
  await cleanImportedTalentDescriptions(actor,controller.catalog.talents);
  await controller.syncBook(actor);
  let panel=panels.get(actor.uuid);if(!panel){panel=new EntropistPanel(actor);panels.set(actor.uuid,panel);}return panel.render(true);
}
function wrapOwnedUses(){
  let spellWrapped=false;
  for(const type of ['spell','feat']){
    const proto=(CONFIG.Item.documentClasses?.[type]??globalThis.pf1?.documents?.item?.[type==='spell'?'ItemSpellPF':'ItemFeatPF'])?.prototype;
    if(!proto)continue;
    if(Object.hasOwn(proto,'_entropistUseWrapped')){
      if(type==='spell')spellWrapped=true;
      continue;
    }
    const original=proto.use;if(typeof original!=='function')continue;
    Object.defineProperty(proto,'_entropistUseWrapped',{value:true,configurable:true});
    proto.use=async function(...args){
      const id=this.getFlag(ID,'talentId');
      if(id&&this.actor)return controller.useTalent(this.actor,id);
      if(this.getFlag(ID,'featId')&&this.actor)return open(this.actor);
      return original.apply(this,args);
    };
    if(type==='spell')spellWrapped=true;
  }
  return spellWrapped;
}
Hooks.once('ready',async()=>{
  if(game.system.id!=='pf1')return;
  try{
    const response=await fetch(`modules/${ID}/data/catalog.json`);if(!response.ok)throw new Error('无法读取原力资料库');
    controller=new Controller(await response.json());
    game.modules.get(ID).api={open,daily:actor=>controller.daily(actor??selectedActor()),getDC:options=>import('./rules.mjs').then(m=>m.calculateDC(options)),controller,version:VERSION};
    controller.nativeBookAvailable=wrapOwnedUses();
    const MenuBase=globalThis.FormApplication??foundry.appv1.api.FormApplication;
    class Menu extends MenuBase{render(){open().catch(err=>ui.notifications.error(err.message));return this;}}
    game.settings.registerMenu(ID,'panel',{name:'熵术士原力管理',label:'打开熵术士面板',hint:'选择角色，设置组列与偏好专注，准备并调用原力。',icon:'fas fa-dice-d4',type:Menu,restricted:false});
    Hooks.on('getActorSheetHeaderButtons',(sheet,buttons)=>{if(sheet.actor?.isOwner)buttons.unshift({label:'熵术士',class:'entropist-panel',icon:'fas fa-dice-d4',onclick:()=>open(sheet.actor)});});
    for(const hook of ['updateActor','createItem','updateItem','deleteItem','createActiveEffect','updateActiveEffect','deleteActiveEffect']){
      Hooks.on(hook,(doc,...args)=>{
        const [options,userId]=args.slice(-2);
        const actor=doc.documentName==='Actor'?doc:doc.actor??(doc.parent?.documentName==='Actor'?doc.parent:doc.parent?.actor);
        if(!actor)return;
        controller.refresh(actor);
        if(userId===game.user.id&&!options?.[ID]?.bookSync)void controller.syncBook(actor);
      });
    }
    Hooks.on('updateWorldTime',()=>{
      const actors=new Set([...game.actors,...[...controller.views].map(view=>view.actor)]);
      for(const actor of actors){
        if(!actor.getFlag(ID,'state'))continue;
        controller.refresh(actor);
        if(!game.users?.activeGM||game.users.activeGM.id===game.user.id)void controller.syncBook(actor);
      }
    });
    Hooks.on('renderChatMessageHTML',bindSaveCard);
    if(game.system.version!=='11.11')ui.notifications.warn(`熵术士原型针对 PF1 11.11，当前为 ${game.system.version}，请先在测试世界验证。`);
    console.info(`PF1 Entropist ${VERSION} ready`);
  }catch(err){console.error(ID,err);ui.notifications.error('熵术士原型加载失败：'+err.message);}
});
