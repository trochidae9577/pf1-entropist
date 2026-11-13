import {VERSION,ELEMENTS,ARRAY_NAMES,LABELS,arrayElements,calculateDC,availableLevel,focusModifier,burnLabel} from './rules.mjs';
import {escapeHTML as e} from './adapter.mjs';
import {favoredElements,simpleBlasts} from './powers.mjs';
const option=(value,label,selected)=>`<option value="${e(value)}" ${String(value)===String(selected)?'selected':''}>${e(label)}</option>`;
function field(name,label,value,type='text'){return `<label>${label}<input name="${name}" type="${type}" value="${e(value)}"></label>`;}
export function updateArrayFields(form){
  const custom=form.elements.array.value==='custom';
  const fields=form.querySelector('[data-custom-array]');
  fields.hidden=!custom;
  const elements=custom?[...new Set([...fields.querySelectorAll('select')].map(select=>select.value))]:arrayElements({array:form.elements.array.value});
  for(const select of form.querySelectorAll('[data-favored-focus]')){
    const saved=select.dataset.favoredFocus;
    const selected=select.value||(!select.dataset.touched?saved:'');
    select.innerHTML=option('','未选择',selected)+elements.map(element=>option(element,element,selected)).join('');
  }
}
export function renderPanel(model,ui={}){
  const {actor,state,stats,feats,catalog,capacities:slots,error}=model;
  const arr=arrayElements(state),owned=new Set(model.learned),filter=ui.search??'';
  const element=ui.element??'',kind=ui.kind??'';
  const rows=catalog.talents.filter(t=>(!element||t.elements.includes(element))&&(!kind||t.kind===kind)&&(!filter||[t.name,t.en,...(t.aliases??[])].join(' ').toLowerCase().includes(filter.toLowerCase()))&&(!ui.learnedOnly||owned.has(t.id))).slice(0,120);
  const focus=state.heirloom?(state.daily?.element??'尚未掷骰'):'传承物缺失';
  const summary=arr.map(el=>`${el} ${focusModifier(state,el,stats.level)>=0?'+':''}${focusModifier(state,el,stats.level)}`).join(' · ');
  const attacks=model.attacks??[];
  const selectAttack=(name,label,value)=>`<label>${label}<select name="${name}">${option('','未绑定',value)}${attacks.map(i=>option(i.id,i.name,value)).join('')}</select></label>`;
  const featNames=['额外原力位','自发原力','适应性通用原力'];
  const known=catalog.talents.filter(t=>owned.has(t.id));
  const powers=[...model.powers.values()];
  const isGM=!!globalThis.game?.user?.isGM;
  const customFields=Array.from({length:4},(_,i)=>`<label>D4 点数 ${i+1}<select name="array${i+1}" data-array-element>${ELEMENTS.map(el=>option(el,el,state.customArray?.[i]??arr[i])).join('')}</select></label>`).join('');
  const favoredField=(index,level)=>`<label>第${index===0?'一':'二'}偏好专注（${level} 级）<select name="favored${index+1}" data-favored-focus="${e(state.favored[index]??'')}" ${stats.level<level?'disabled':''}>${option('','未选择',state.favored[index])}${arr.map(el=>option(el,el,state.favored[index])).join('')}</select></label>`;
  const favored=favoredElements(state,stats.level);
  const dailyBlasts=simpleBlasts(catalog.talents,state.daily?.element);
  const dailyNeedsBlast=state.heirloom&&dailyBlasts.length>1&&!favored.includes(state.daily.element)&&!dailyBlasts.some(t=>t.id===state.daily.blastId);
  const favoredBlastFields=favored.map(element=>{
    const blasts=simpleBlasts(catalog.talents,element);
    const selected=blasts.find(t=>t.id===state.favoredBlasts[element])??(blasts.length===1?blasts[0]:null);
    if(blasts.length===1||(selected&&!isGM))return `<p>${e(element)} · ${e(selected.name)}</p>`;
    return `<label>${e(element)}<select required name="${e(element)}">${option('','请选择',selected?.id??'')}${blasts.map(t=>option(t.id,t.name,selected?.id)).join('')}</select></label>`;
  });
  return `<div class="entropist-root">
  <header><div><h2>熵术士 · ${e(actor.name)}</h2><p>原力准备与每日专注 · ${VERSION}</p></div><button data-do="refresh">刷新</button></header>
  ${error?`<p class="error">${e(error)}</p>`:''}
  <section class="status"><strong>第 ${state.day} 天 · 流转专注：${e(focus)}</strong><span>${e(summary)}</span><span>职业 ${stats.level} 级 · 体质 ${stats.constitution}（${stats.conMod>=0?'+':''}${stats.conMod}） · 超载 ${state.burn} / ${3+stats.conMod}</span><small>调用不消耗准备位。正文效果与减免尚需按规则处理。</small></section>
  <nav><button data-tab="prepare" class="${(ui.tab??'prepare')==='prepare'?'active':''}">每日准备</button><button data-tab="library" class="${ui.tab==='library'?'active':''}">原力资料库</button><button data-tab="settings" class="${ui.tab==='settings'?'active':''}">熵术士设置</button></nav>
  ${(ui.tab??'prepare')==='prepare'?`<section>
    <div class="toolbar"><button data-do="daily">掷 D4 · 新一天</button><button data-do="manual">录入 D4 · 新一天</button><button data-do="reroll" ${stats.level<9||!state.daily||state.daily.chosen||state.daily.bendUsed?'disabled':''}>扭转命运 · 重掷</button><button data-do="choose" ${stats.level<17||!state.daily||state.daily.chosen?'disabled':''}>扭转命运 · 指定</button>${stats.level>=20?`<button data-do="full-array" ${!state.daily||state.daily.chosen?'disabled':''}>完整组列 · 3 点超载</button>`:''}<button data-do="rest">完成整夜休息 · 清超载</button></div>
    <div class="slots">${Array.from({length:availableLevel(stats.level)},(_,i)=>{const t=i+1,used=Object.values(state.prepared).filter(s=>Number(s)===t).length+(state.temporary?.slot===t?1:0);return `<span>${t} 级位 <b>${used} / ${slots?.[t]??0}</b></span>`;}).join('')}</div>
    <p class="hint">在本面板更改准备，已绑定的原生法术书会同步显示。普通准备请完成规则要求的睡眠与传承物冥想。</p>
    <h3>专注授予的能力</h3>
    ${dailyNeedsBlast?'<button data-do="daily-blast">选择当日简易念袭</button>':''}
    ${powers.length?`<div class="talent-table"><table><thead><tr><th>能力</th><th>使用资格</th><th>操作</th></tr></thead><tbody>${powers.map(grant=>`<tr><td><button class="text-link" data-do="detail" data-id="${e(grant.talent.id)}">${e(grant.talent.name)}</button></td><td>${e(grant.source)} · 有效 ${grant.effectiveLevel} 级${grant.defenseEnhancement?` · 护身强化 +${grant.defenseEnhancement}`:''}</td><td><button data-do="cast" data-id="${e(grant.talent.id)}">调用</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">完成流转专注或偏好专注设置后显示。</p>'}
    <h3>已掌握原力 <small>${known.length} 项</small></h3>
    ${known.length?`<div class="talent-table"><table><thead><tr><th>原力</th><th>类别／等级</th><th>准备位</th><th>基准 DC</th><th>操作</th></tr></thead><tbody>${known.map(t=>{
      const slot=state.prepared[t.id],temp=state.temporary?.id===t.id;let dc='—';
      try{if(!t.incomplete&&!t.exempt&&!['blast','composite'].includes(t.kind))dc=calculateDC({talent:t,stats,state,slot:slot??(temp?state.temporary.slot:undefined),adaptive:!!feats.adaptive}).dc;}catch{dc='需选择元素';}
      const granted=(state.granted??[]).includes(t.id);
      return `<tr><td><button class="text-link" data-do="detail" data-id="${t.id}">${e(t.name)}</button>${temp?'<small>临时可用</small>':''}</td><td>${e(LABELS[t.kind])}／${t.level??'动态'}</td><td>${t.exempt?`<button data-do="grant" data-id="${t.id}">${granted?'已启用资格':'启用资格'}</button>`:!['blast','composite','infusion'].includes(t.kind)?`<select data-prepare="${t.id}">${option('','未准备',slot??'')}${Object.keys(slots??{}).filter(s=>slots[s]>0&&s>=t.level).map(s=>option(s,`${s} 级位`,slot)).join('')}</select>`:'关联原念袭'}</td><td>${dc}</td><td><button data-do="cast" data-id="${t.id}">调用</button>${feats.spontaneous&&!slot&&!t.exempt&&!['blast','composite'].includes(t.kind)?`<button data-do="spontaneous" data-id="${t.id}">自发</button>`:''}<button data-do="forget" data-id="${t.id}" title="移除本模组原力条目">移除</button></td></tr>`;
    }).join('')}</tbody></table></div>`:'<p class="empty">先到原力资料库学习原力。升级不会自动添加已知原力。</p>'}
    <h3>原有念袭</h3><div class="toolbar"><button data-do="blast" data-kind="energy">调用已绑定能量念袭</button><button data-do="blast" data-kind="physical">调用已绑定物理念袭</button></div><p class="hint">先选择可用念袭和注能，再使用原 PF 攻击。注能的豁免和效果见组合卡。</p>
  </section>`:''}
  ${ui.tab==='library'?`<section><div class="filters"><input data-filter="search" value="${e(filter)}" placeholder="搜索中文或英文名称"><select data-filter="element">${option('','全部元素',element)}${['泛用',...ELEMENTS].map(x=>option(x,x,element)).join('')}</select><select data-filter="kind">${option('','全部类别',kind)}${Object.entries(LABELS).map(([v,n])=>option(v,n,kind)).join('')}</select><label><input type="checkbox" data-filter="learnedOnly" ${ui.learnedOnly?'checked':''}>只看已掌握</label></div><p class="hint">${catalog.talents.length} 个版本条目；同名不同版本分别保留。每页最多显示 120 项，请用筛选定位。“仅索引”不能自动施放。</p><div class="cards">${rows.map(t=>`<article><h3>${e(t.name)}</h3><small>${e(t.en)} · ${e(t.elements.join('／'))}</small><p>${e(LABELS[t.kind])} · ${t.level??'动态'} 级 · 超载 ${e(burnLabel(t))}</p><span class="badge">${t.incomplete?'仅索引':'正文可查 · 效果手动'}</span><div><button data-do="detail" data-id="${t.id}">规则正文</button><button data-do="learn" data-id="${t.id}" ${owned.has(t.id)||t.incomplete?'disabled':''}>${owned.has(t.id)?'已掌握':'学习／导入'}</button></div></article>`).join('')}</div></section>`:''}
  ${ui.tab==='settings'?`<section><form data-form="settings"><label>位面组列<select name="array">${Object.entries(ARRAY_NAMES).map(([v,n])=>option(v,n,state.array)).join('')}${option('custom','自定义组列',state.array)}</select></label><fieldset data-custom-array ${state.array==='custom'?'':'hidden'}><legend>自定义 D4 对应</legend><div class="form-grid">${customFields}</div></fieldset><p class="hint">更改组列后需重新确定流转专注。移出组列的原力会解除准备。</p><div class="form-grid"><label>绑定职业<select name="classId">${option('','自动识别操念使',state.classId)}${model.classes.map(c=>option(c.id,c.name,state.classId)).join('')}</select></label>${field('levelOverride','手动职业等级（留空自动）',state.levelOverride??'','number')}${favoredField(0,7)}${favoredField(1,15)}${selectAttack('energy','能量念袭条目',state.binding.energy)}${selectAttack('physical','物理念袭条目',state.binding.physical)}${field('extraSlots','额外原力位分配（例：1,2）',state.extraSlots.join(','))}<label><input type="checkbox" name="heirloom" ${state.heirloom?'checked':''}>持有同调传承物</label></div><button type="submit">保存并确认偏好专注</button></form>
  ${favoredBlastFields.length?`<h3>偏好专注的简易念袭</h3><form data-form="favored-blasts"><div class="form-grid">${favoredBlastFields.join('')}</div>${favoredBlastFields.some(field=>field.startsWith('<label>'))?'<button type="submit">确认偏好念袭</button>':''}</form>`:''}
  <h3>专长</h3><div class="toolbar">${catalog.feats.map((f,i)=>`<button data-do="feat" data-id="${f.id}">添加${featNames[i]}</button>`).join('')}</div><p>额外原力位 × ${feats.extra} · 自发原力 ${feats.spontaneous?'已取得':'未取得'}（今日已用 ${state.spontaneousUsed} 次） · 适应性通用原力 ${feats.adaptive?'已取得':'未取得'}</p><div class="toolbar"><button data-do="book">接入体质准备法术书</button><button data-do="feature">导入熵术士职业说明</button><button data-do="macros">建立快捷宏</button></div></section>`:''}
  </div>`;
}
