import {assert,integer} from './rules.mjs';
import {blastBurn,infusionBurn} from './powers.mjs';
import {metakinesisCost} from './metakinesis.mjs';

export const gatherActions={none:'不凝聚',move:'本回合移动动作',full:'上回合整轮动作',both:'上回合整轮＋本回合移动动作'};
export const masterOptions={empower:'强效',maximize:'极效',quicken:'瞬发'};

export function gatherLimit(level,mode){
  assert(Object.hasOwn(gatherActions,mode),'请选择有效的凝聚动作');
  const move=level>=11?2:1,full=move+1;
  return {none:0,move,full,both:move+full}[mode];
}

export function blastCost(blast,infusions,level,master,values){
  const base=blastBurn(blast,level),infusion=infusionBurn(infusions,level);
  const meta={empower:values.empower==='on',maximize:values.maximize==='on',quicken:values.quicken==='on'};
  const metaCost=metakinesisCost(level,meta);
  const mastery=Number(level>=19&&Object.hasOwn(masterOptions,master)&&meta[master]);
  const mode=values.gather??'none',limit=gatherLimit(level,mode);
  const other=integer(values.reduction??0,0,99,'其他减免');
  const subtotal=base.net===null||infusion.net===null?null:base.net+infusion.net+metaCost-mastery;
  const gathered=subtotal===null?null:Math.min(limit,subtotal);
  const auto=subtotal===null?null:Math.max(0,subtotal-gathered-other);
  const override=values.burn!=null&&values.burn!=='';
  const gross=override?integer(values.burn,0,99,'实际超载'):auto;
  const buffer=Number(values.buffer==='on'&&gross>0);
  const amount=gross===null?null:gross-buffer;
  return {base,infusion,meta,metaCost,mastery,master,mode,limit,gathered,other,auto,override,amount,buffer};
}

export function costSummary(cost,level){
  const {base,metaCost,master,mastery,mode,limit,gathered,other,amount,override}=cost;
  const parts=[];
  if(base.limit)parts.push(`复合熟稔：念袭本体 ${base.cost??'按正文'}，减免上限 1，实付 ${base.net??'按正文'}`);
  if(metaCost)parts.push(`超念 ${metaCost} 点`);
  if(mastery)parts.push(`超念大师（${masterOptions[master]}）减 1 点`);
  if(mode!=='none')parts.push(`念力凝聚${level>=11?'（超聚合）':''}：${gatherActions[mode]}，${gathered===null?'最多减 '+limit:'实减 '+gathered} 点`);
  if(cost.buffer)parts.push("储念器抵付 1 点");
  if(other)parts.push(`其他减免 ${other} 点`);
  parts.push(amount===null?'费用按正文，请填写实际超载':`${override?'手动指定':'本次实付'} ${amount} 点超载`);
  return parts.join(' · ');
}
