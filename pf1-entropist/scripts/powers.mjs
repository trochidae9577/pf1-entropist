import {baseBurn, matchPrerequisites, talentNames} from './rules.mjs';

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

export function matchesInfusion(infusion,blast){
  if(blast.id==='entropist-array-blast'&&infusion.elements.some(element=>blast.elements.includes(element)))return true;
  const names=blastNames(blast);
  const associated=(infusion.associated??'').normalize('NFKC');
  return associated.split(/[、,;；]/).some(raw=>{
    const term=raw.trim().toLowerCase().replace(/^(?:或者?|and\b|or\b)\s*/i,'');
    if(names.includes(term)||names.includes(term.replace(/\([^()]*\)/g,'').trim()))return true;
    if(/^(任意|任何|any)(?:念袭| blast)?$/i.test(term))return true;
    const generic=term.replace(/\s+/g,'').match(/^(?:任意|任何)(?:(物理|能量))?(?:(简易|复合))?念袭$/);
    if(!generic)return false;
    const kind=generic[1]==='物理'?'physical':generic[1]==='能量'?'energy':null;
    const form=generic[2]==='简易'?'blast':generic[2]==='复合'?'composite':null;
    return (!kind||blastKind(blast)===kind)&&(!form||blast.kind===form);
  });
}

export function comboBurn(blast,infusions,level){
  const costs=[blast,...infusions].map(talent=>baseBurn(talent));
  if(costs.includes(null))return null;
  const specialization=level>=5?1+Math.floor((level-5)/3):0;
  const base=Math.max(0,costs[0]-(blast.kind==='composite'&&level>=16?1:0));
  const infusionCost=costs.slice(1).reduce((sum,cost)=>sum+cost,0);
  return base+Math.max(0,infusionCost-specialization);
}
