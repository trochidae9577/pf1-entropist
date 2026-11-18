import {arrayElements,baseBurn, matchPrerequisites, talentNames} from './rules.mjs';

export function normalizedElements(talent){
  const aliases={'地':['土'],'：地':['土'],'：土':['土'],'风':['气'],'水木':['水','木']};
  return [...new Set(talent.elements.flatMap(name=>aliases[name]??[name]))];
}

export function blastKind(talent){
  const match=talent.body.match(/念袭(?:性质|类型)\s*[:：]?\s*(物理|能量)/);
  return match?.[1]==='能量'?'energy':match?.[1]==='物理'?'physical':null;
}

export function favoredElements(state,level){
  return (state.favored??[]).slice(0,level>=15?2:level>=7?1:0);
}

export function simpleBlasts(catalog,element){
  return catalog.filter(t=>t.kind==='blast'&&!t.incomplete&&t.elements.includes(element));
}

const shortBlastNames={
  'Acid Blast':['强酸'], 'Air Blast':['气'], 'Cold Blast':['寒冷'], 'Earth Blast':['土'],
  'Electric Blast':['电击'], 'Fire Blast':['火焰'], 'Light Blast':['光'],
  'Negative Blast':['负能量'], 'Positive Blast':['正能量'], 'Sonic Blast':['音波'],
  'Water Blast':['水'], 'Wood Blast':['木'], 'Force Blast':['力场'],
  'Void Blast':['虚空'], 'Blue Flame Blast':['蓝炎击'],
};

function blastNames(talent){
  return [...talentNames(talent),...(shortBlastNames[talent.en]??[])];
}

function qualifiesComposite(talent,active,focusElements,repeatedFocus){
  if(!talent.prerequisites)return false;
  const names=active.flatMap(blastNames);
  const requirement=talent.prerequisites.normalize('NFKC');
  const primary=requirement.match(/(?:首要|主修)元素\s*\(([^()]+)\)/)?.[1];
  const expanded=requirement.match(/(?:元素扩展|扩展元素)\s*\(([^()]+)\)/)?.[1];
  if(primary&&primary===expanded&&primary!==repeatedFocus)return false;
  return matchPrerequisites(requirement,term=>{
    if(names.includes(term))return true;
    const focus=term.match(/^(首要元素|主修元素|元素扩展|扩展元素)\s*\(([^()]+)\)$/);
    if(focus){
      if(focus[2]==='任意')return focusElements.length>1||!!repeatedFocus;
      return focusElements.includes(focus[2]);
    }
    const alternate=term.match(/^(?:任意|任何)其他(?:简易)?(物理|能量)?(?:简易|复合)?念袭$/);
    if(alternate){
      return active.some(blast=>{
        if(talentNames(blast).some(name=>requirement.toLowerCase().includes(name)))return false;
        const kind=term.includes('复合')?'composite':'blast';
        const mode=alternate[1]==='能量'?'energy':alternate[1]==='物理'?'physical':null;
        return blast.kind===kind&&(!mode||blastKind(blast)===mode);
      });
    }
    return false;
  })===true;
}

export function availablePowers(state,level,catalog){
  const result=new Map();
  if(level<1)return result;
  const favored=favoredElements(state,level);
  const daily=state.heirloom?state.daily?.element:null;
  const repeatedFocus=favored.includes(daily)?daily:null;
  const effectiveLevel=state.heirloom?level:Math.floor(level/5);

  function grant(talent,source,permanent=false,defenseEnhancement=0){
    if(!talent||talent.incomplete||result.get(talent.id)?.permanent)return;
    result.set(talent.id,{talent,source,permanent,effectiveLevel,defenseEnhancement});
  }

  function grantElement(element,permanent){
    const source=permanent?'偏好专注':'流转专注';
    const candidates=simpleBlasts(catalog,element);
    const selectedId=permanent?state.favoredBlasts?.[element]:state.daily?.blastId;
    const chosen=candidates.find(t=>t.id===selectedId);
    grant(chosen??(candidates.length===1?candidates[0]:null),source,permanent);
    if(!permanent&&repeatedFocus===element){
      for(const candidate of candidates)if(!result.has(candidate.id))grant(candidate,'专注重合');
    }
    const basics=catalog.filter(t=>t.kind==='utility'&&t.exempt&&t.elements.includes(element)&&!t.incomplete);
    const standard=basics.find(t=>t.indexKey&&t.name.startsWith('基础'))??basics.find(t=>t.name.startsWith('基础'));
    const substitute=permanent?null:basics.find(t=>t!==standard&&(state.granted??[]).includes(t.id));
    grant(substitute??standard,source,permanent);
    if(state.heirloom&&level>=2){
      const defenses=catalog.filter(t=>t.kind==='defense'&&t.elements.includes(element)&&!t.incomplete);
      const defense=defenses.find(t=>(state.granted??[]).includes(t.id))??defenses[0];
      grant(defense,source,permanent,repeatedFocus===element?Math.min(3,Math.floor(level/6)):0);
    }
  }

  function grantComposites(elements,repeat,permanent){
    const candidates=catalog.filter(t=>t.kind==='composite'&&!t.incomplete&&t.prerequisites);
    let active=[...result.values()].filter(g=>(!permanent||g.permanent)&&['blast','composite'].includes(g.talent.kind)).map(g=>g.talent);
    let remaining=candidates.filter(t=>!result.has(t.id));
    while(remaining.length){
      const gained=remaining.filter(t=>qualifiesComposite(t,active,elements,repeat));
      if(!gained.length)break;
      for(const talent of gained)grant(talent,permanent?'偏好专注组合':'当日专注组合',permanent);
      active=[...active,...gained];
      remaining=remaining.filter(t=>!result.has(t.id));
    }
  }

  for(const element of favored)grantElement(element,true);
  if(favored.length===2)grantComposites(favored,null,true);
  if(daily){
    grantElement(daily,false);
    if(favored.length)grantComposites([...new Set([daily,...favored])],repeatedFocus,false);
  }
  if(level>=20&&state.heirloom)grant(catalog.find(t=>t.id==='entropist-array-blast'),'完整组列',true);
  return result;
}

export function grantedBlasts(powers,state,actor){
  return Array.from(powers.values(),grant=>grant.talent)
    .filter(t=>t.kind==='blast'||t.kind==='composite')
    .map(t=>{
      if(t.id==='entropist-array-blast')return {...t,elements:arrayElements(state)};
      if(t.en==='Water Blast')return {...t,bloodKineticist:Array.from(actor?.items??[]).some(i=>['class','feat'].includes(i.type)&&/血操念使|blood kineticist/i.test(i.name))};
      return t;
    });
}

export function linkInfusionBases(catalog){
  const blasts=catalog.filter(t=>['blast','composite'].includes(t.kind));
  const shorthand=s=>s.replace(/念袭$/,'');
  for(const t of blasts.filter(t=>t.kind==='composite')){
    const refs=[...t.body.matchAll(/可(?:以)?使用([^。；\n]{1,80}?)的(?:任何|所有|全部)?关联注能/g)];
    const terms=new Set(refs.flatMap(m=>m[1].split(/以及|[、，,和与或]/).map(x=>shorthand(x.trim()))));
    if(terms.size)t.infusionBases=blasts.filter(b=>b.id!==t.id&&blastNames(b).some(n=>terms.has(shorthand(n))));
  }
}

export function matchesInfusion(infusion,blast){
  return directMatch(infusion,blast)||(blast.infusionBases??[]).some(base=>directMatch(infusion,base));
}

function directMatch(infusion,blast){
  if(blast.id==='entropist-array-blast'&&infusion.elements.some(element=>blast.elements.includes(element)))return true;
  if(/^(?:improved )?bloody infusion$/i.test(infusion.en)&&blast.en==='Water Blast'&&!blast.bloodKineticist)return false;
  if(infusion.en==='Bullying Infusion'&&!infusion.associated)return true;
  const names=blastNames(blast);
  const associated=(infusion.associated??'').normalize('NFKC');
  if(/^任意简易或复合(?:念袭)?$/.test(associated))return true;
  if(associated.includes('至少两种伤害类型的物理念袭')){
    const line=blast.body.match(/伤害(?:类型)?\s*[:：]?\s*([^；\n]+)/)?.[1]??'';
    return blastKind(blast)==='physical'&&(!/或/.test(line)||/一半.+一半|任意两种/.test(line))&&new Set(line.match(/钝击|穿刺|挥砍|火焰|强酸|寒冷|音波|闪电|电击|力场|负能量|正能量/g)).size>=2;
  }
  if(infusion.en?.toLowerCase()==='foxfire infusion')return ['Blue Flame Blast','Fire Blast','Positive Blast'].includes(blast.en);
  return associated.replace(/\)\s+(?=[^()]+\()/g,'),').split(/[、,;；]|\s+或\s+|\bor\b/i).some(raw=>{
    const term=raw.trim().toLowerCase().replace(/^(?:或者?|and\b|or\b)\s*/i,'');
    const english=term.match(/\(([a-z ]+)\)/)?.[1];
    if(english&&blast.en?.toLowerCase()===english+' blast')return true;
    if(names.includes(term)||names.includes(term.replace(/\([^()]*\)/g,'').trim()))return true;
    if(/^(任意|任何|any)(?:念袭| blast)?$/i.test(term))return true;
    const generic=term.replace(/\s+/g,'').match(/^(?:任意|任何)(?:(物理|能量))?(?:(简易|复合))?念袭$/);
    if(!generic)return false;
    const kind=generic[1]==='物理'?'physical':generic[1]==='能量'?'energy':null;
    const form=generic[2]==='简易'?'blast':generic[2]==='复合'?'composite':null;
    return (!kind||blastKind(blast)===kind)&&(!form||blast.kind===form);
  });
}

export function infusionAvailability(talent,blasts){
  if(!['form','substance'].includes(talent.kind))return null;
  const names=blasts.filter(b=>matchesInfusion(talent,b)).map(b=>b.name);
  return {usable:names.length>0,text:names.length?'当前可搭配：'+names.join('、'):'当前专注没有匹配的念袭',required:talent.associated||'见规则正文'};
}

export function infusionBurn(infusions,level){
  const limit=Math.min(6,Math.max(0,Math.floor((level-2)/3)));
  const costs=infusions.map(talent=>baseBurn(talent));
  if(costs.includes(null))return {limit,raw:null,discount:null,net:null};
  const raw=costs.reduce((sum,cost)=>sum+cost,0);
  const discount=Math.min(limit,raw);
  return {limit,raw,discount,net:raw-discount};
}

export function blastBurn(blast,level){
  const cost=baseBurn(blast);
  const limit=Number(blast.kind==='composite'&&level>=16);
  return {cost,limit,net:cost===null?null:Math.max(0,cost-limit)};
}

export function comboBurn(blast,infusions,level){
  const base=blastBurn(blast,level).net,infusion=infusionBurn(infusions,level).net;
  return base===null||infusion===null?null:base+infusion;
}
