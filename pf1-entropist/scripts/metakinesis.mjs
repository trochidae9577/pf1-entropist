import {ID,assert} from './rules.mjs';

export function metakinesisCost(level,{empower,maximize,quicken}){
  assert(!empower||level>=5,'强效超念需要熵术士 5 级');
  assert(!maximize||level>=9,'极效超念需要熵术士 9 级');
  assert(!quicken||level>=13,'瞬发超念需要熵术士 13 级');
  return (empower?1:0)+(maximize?2:0)+(quicken?3:0);
}

export function configureBlastDamage(use){
  const choice=use.shared.useOptions?.[ID];
  if(choice?.quicken){
    use.shared.rollData.action.activation={type:'swift',cost:1};
    const addNotes=use.addFootnotes.bind(use);
    use.addFootnotes=async function(){await addNotes();use.shared.templateData.footnotes.push({text:'瞬发超念 · 迅捷动作'});};
  }
  if(choice?.chronoLevel)use.shared.rollData[ID]={chronoLevel:choice.chronoLevel};
  if(choice?.profile)use.shared.rollData[ID]={profile:choice.profile};
  if(!choice?.empower&&!choice?.maximize&&!choice?.profile&&!choice?.half&&!choice?.zero)return;
  // This ActionUse belongs to just one activation, including its selected PF1 action.
  const generate=use.generateChatAttacks.bind(use);
  use.generateChatAttacks=async function(...args){
    await generate(...args);
    for(const attack of use.shared.chatAttacks){
      let normalSum=0, adjustedSum=0, beforeHalf=0;
      for(const damage of [attack.damage,attack.critDamage]){
        if(!damage.rolls.length)continue;
        const adjusted=[];
        for(const roll of damage.rolls){
          // Only the variable damage rolls and their included modifiers qualify.
          if(roll.isDeterministic&&!choice.profile&&!choice.half&&!choice.zero){
            adjusted.push(roll);
            adjustedSum+=roll.total;
            continue;
          }
          const base=choice.maximize&&!roll.isDeterministic?await roll.reroll({maximize:true}):roll;
          const index=Number(roll.formula?.match(/念袭分项(\d+)/)?.[1]);
          const groups=choice.profile?.parts[index]?.groups;
          if(choice.half||choice.zero||groups?.length>1){
            let total=base.total;
            if(choice.empower&&!roll.isDeterministic){
              total+=Math.floor((normalSum+roll.total)/2)-Math.floor(normalSum/2);
              normalSum+=roll.total;
            }
            if(choice.half){const before=beforeHalf;beforeHalf+=total;total=Math.floor(beforeHalf/2)-Math.floor(before/2);}
            if(choice.zero)total=0;
            const types=groups??[roll.options.damageType];
            for(const [i,damageType] of types.entries()){
              const share=Math.floor(total*(i+1)/types.length)-Math.floor(total*i/types.length);
              adjusted.push(await new roll.constructor(`${share}[念袭结算]`,{},{...roll.options,damageType}).evaluate());
            }
            adjustedSum+=total;
            continue;
          }
          adjusted.push(base);
          adjustedSum+=base.total;
          if(choice.empower&&!roll.isDeterministic){
            const bonus=Math.floor((normalSum+roll.total)/2)-Math.floor(normalSum/2);
            normalSum+=roll.total;
            const extra=await new roll.constructor(`${bonus}[强效]`,{},roll.options).evaluate();
            adjusted.push(extra);
            adjustedSum+=bonus;
          }
        }
        damage.rolls=adjusted;
        // PF1 stores critical rolls as extra damage, but displays a combined total.
        damage.total=choice.zero||choice.half?Math.max(0,adjustedSum):Math.max(1,adjustedSum);
      }
    }
  };
}

// PF1 copies the action's roll data for each normal/critical damage roll.
export function applyChronoDamage(action,rollData,parts){
  const profile=rollData[ID]?.profile;
  if(profile&&parts.length){
    const primary=parts[0];
    parts.splice(0,1,...profile.parts.map((part,i)=>({...primary,extra:i===0?primary.extra:[],
      base:`${part.n}d${part.d}[念袭分项${i}] + (${part.b})`,damageType:part.groups[0]})));
    rollData.action.ability.damage='';
    return;
  }
  const level=rollData[ID]?.chronoLevel;
  if(!level||!parts.length)return;
  const dice=Math.ceil(level/2);
  const conDamage=Math.floor((rollData.abilities?.con?.mod??0)/2);
  parts[0].base=`${dice}d4 + (${conDamage})`;
  parts[0].damageType=['untyped'];
  // The formula includes Constitution even when the bound action uses another ability.
  rollData.action.ability.damage='';
}
