import {ID} from './rules.mjs';
import {readState} from './adapter.mjs';

export function clearBurn(state){
  return {...state,burn:0,burnNonlethal:0,roundBurn:0,roundKey:''};
}

export function protectBurn(actor,change,options){
  if(!actor.getFlag(ID,'state')||options?.pf1?.action==='rest'&&options.pf1.restOptions?.hours>=8)return;
  const key='system.attributes.hp.nonlethal';
  const flat=Object.hasOwn(change,key),hp=change.system?.attributes?.hp;
  const next=flat?change[key]:hp?.nonlethal;
  if(!Number.isFinite(next))return;
  // Module resource transactions include the new ledger and the new HP atomically.
  if(change.flags?.[ID]?.state!==undefined||Object.hasOwn(change,`flags.${ID}.state`))return;
  const floor=Math.min(actor.system.attributes.hp.nonlethal,readState(actor).burnNonlethal??0);
  if(flat)change[key]=Math.max(floor,next);
  else hp.nonlethal=Math.max(floor,next);
}

export function nativeRest(actor,options,update){
  if(options.hours<8||!actor.getFlag(ID,'state'))return;
  const state=readState(actor);
  if(!state.burn&&!state.burnNonlethal)return;
  const hp=actor.system.attributes.hp.nonlethal??0;
  if((state.burnNonlethal??0)>hp){
    ui.notifications.warn('当前瘀伤少于旧超载记录，请先在熵术士面板的整夜休息窗口核对剩余超载瘀伤，再执行 PF1 休息。');
    return false;
  }
  const key='system.attributes.hp.nonlethal';
  const after=update[key]??update.system?.attributes?.hp?.nonlethal??hp;
  const remaining=Math.max(0,after-(state.burnNonlethal??0));
  delete update[key];
  foundry.utils.setProperty(update,key,remaining);
  foundry.utils.setProperty(update,`flags.${ID}.state`,JSON.stringify(clearBurn(state)));
}
