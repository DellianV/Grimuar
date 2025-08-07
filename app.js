// Гримуар SRD — Netlify build/fetch version
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let ALL = [];
let FILTERED = [];
let FAVS = new Set(JSON.parse(localStorage.getItem('favs') || '[]'));

const searchEl = $('#search');
const sortEl = $('#sort');
const listEl = $('#list');
const modal = $('#modal');
const mClose = $('#m-close');
const mFav = $('#m-fav');
const mCopy = $('#m-copy');

const SRC_URL = './data/spells.json';

async function load() {
  try {
    const res = await fetch(SRC_URL, {cache: 'reload'});
    if (!res.ok) throw new Error('no local data');
    ALL = await res.json();
  } catch (e) {
    // First run: fetch from Open5e API (SRD)
    ALL = await fetchFromOpen5e();
    // Store to local file cache (Service Worker will keep), and to localStorage snapshot
    try { localStorage.setItem('snapshot_spells', JSON.stringify(ALL)); } catch {}
  }
  ALL = ALL.map(s => ({...s, tags: autoTags(s)}));
  render();
}

async function fetchFromOpen5e(){
  const out = [];
  const base = 'https://api.open5e.com/spells/?document__slug=wotc-srd&limit=2000';
  let url = base;
  while (url) {
    const r = await fetch(url);
    const j = await r.json();
    for (const s of j.results) {
      out.push(transformOpen5e(s));
    }
    url = j.next;
  }
  return out;
}

function transformOpen5e(s) {
  // s has: name, level_int, school, classes, casting_time, range, components, duration, concentration, ritual, desc, higher_level
  const classes = (s.dnd_class || s.classes || '').toLowerCase()
    .replace(/\s/g,'').split(',').filter(Boolean);
  const comps = String(s.components||'').toUpperCase();
  const mNeeded = /M/.test(comps);
  return {
    id: slugify(s.name),
    name: s.name, // EN name; localization map may replace on the fly
    level: s.level_int ?? parseLevel(s.level),
    school: (s.school||'').toLowerCase(),
    classes,
    casting_time: s.casting_time || '',
    range: s.range || '',
    components: {v:/V/.test(comps), s:/S/.test(comps), m:mNeeded},
    duration: s.duration || '',
    concentration: /concentration/i.test(s.concentration||s.duration||'') || s.concentration === true,
    ritual: /ritual/i.test(s.ritual||'') || /ритуал/i.test(s.ritual||''),
    damage: null,
    save: null,
    description: synthesizeRuSummary(s),
    higher_levels: (s.higher_level||'').trim() ? 'При усилении: ' + simpleRu(s.higher_level) : null,
    source: "SRD 5.1",
    tags: [],
    notes: "",
    effects: deriveEffects(s)
  };
}

function parseLevel(lv){
  if (typeof lv === 'number') return lv;
  const m = String(lv||'').match(/\d/);
  return m ? +m[0] : 0;
}

function slugify(x){return x.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');}

function simpleRu(text){
  // ultra-simple RU-ification for common terms; it's not a translation of rules text.
  return String(text||'')
    .replace(/Concentration/gi,'Концентрация')
    .replace(/ritual/gi,'ритуал')
    .replace(/minute(s)?/gi,'мин.')
    .replace(/hour(s)?/gi,'ч.')
    .replace(/round(s)?/gi,'раунд.')
    .replace(/feet/gi,'фут.')
    .replace(/range/gi,'дистанция')
    .replace(/damage/gi,'урон')
    ;
}

function deriveEffects(s){
  const t = (s.desc||'').toLowerCase();
  const fx = [];
  if (/\bdamage\b|\b1d|2d|3d|4d|5d/.test(t)) fx.push('damage');
  if (/ac\b|shield|cover/.test(t)) fx.push('ac_up');
  if (/heal|hit points|regain/.test(t)) fx.push('heal');
  if (/paraly|restrain|stun|blind|deafen|charm|frighten|banish|hold/.test(t)) fx.push('control');
  if (/teleport|fly|misty|dimension door|move/.test(t)) fx.push('movement');
  if (/detect|identify|see|scry/i.test(t)) fx.push('scout');
  if (/invisible|light|clean|message|mend|shape water/.test(t)) fx.push('utility');
  return fx;
}

function synthesizeRuSummary(s){
  // Not a translation of SRD text; a lawful minimal RU summary for table use.
  const lvl = s.level_int ?? parseLevel(s.level);
  const school = ruSchool((s.school||'').toLowerCase());
  const time = s.casting_time || '';
  const rng = s.range || '';
  const dur = (s.duration||'').replace(/Concentration.*?\)/i,'Концентрация');
  let line = `${lvl===0?'Трюк':lvl+' ур.'} · ${school} · ${time} · ${rng} · ${simpleRu(dur)}`;
  // small hint based on keywords
  const t = (s.desc||'').toLowerCase();
  const hints = [];
  if (/damage|1d|2d|3d|4d|5d/.test(t)) hints.push('урон');
  if (/heal|hit points|regain/.test(t)) hints.push('исцеление');
  if (/charm|frighten|paraly|restrain|stun|hold|sleep/.test(t)) hints.push('контроль');
  if (/teleport|fly|misty|door|dimension/.test(t)) hints.push('перемещение');
  if (/detect|identify|see|scry/.test(t)) hints.push('разведка');
  if (hints.length) line += ` · намёк: ${hints.join(', ')}`;
  return line;
}

function autoTags(sp) {
  const tags = new Set(sp.tags || []);
  const text = [sp.name, sp.description, sp.higher_levels].filter(Boolean).join(' ').toLowerCase();

  const has = k => (sp.effects||[]).includes(k) || text.includes(k);
  const any = (...arr) => arr.some(a => text.includes(a));

  if (sp.damage || has('damage') || any('урон','поврежд')) tags.add('Атакующие');
  if (has('ac_up') || any('кд','щит','сопротивл','укрыт')) tags.add('Защитные');
  if (any('очарован','убежден','правд','эмоци','внуш','язык','понимает')) tags.add('Социальные');
  if (has('control') || any('парализ','удерж','ослеп','оглуш','затрудн','связ','страх','очар')) tags.add('Контроль');
  if (has('heal') || any('лечение','исцел')) tags.add('Исцеляющие');
  if (has('scout') || any('обнаруж','виден','ясновид','идентифиц')) tags.add('Разведка');
  if (has('movement') || any('перемещ','телепорт','прыж','полёт')) tags.add('Перемещение');
  if (sp.ritual || any('починка','освещ','чист','сообщ','невидим')) tags.add('Ютилити');
  return Array.from(tags);
}

function ruSchool(s){
  const map={
    abjuration:'Ограждение',conjuration:'Вызов',divination:'Прорицание',
    enchantment:'Очарование',evocation:'Воплощение',illusion:'Иллюзия',
    necromancy:'Некромантия',transmutation:'Преобразование'
  };
  return map[s]||s;
}

function render() {
  const q = (searchEl.value || '').trim().toLowerCase();
  const lvls = valuesOfMulti('#level');
  const schools = valuesOfMulti('#school');
  const classes = valuesOfMulti('#classes');
  const tags = valuesOfMulti('#tags');
  const onlyConc = $('#concentration').checked;
  const onlyRit = $('#ritual').checked;
  const onlyFavs = $('#favorites').checked;
  const cV = $('#compV').checked, cS = $('#compS').checked, cM = $('#compM').checked;

  FILTERED = ALL.filter(sp => {
    if (q) {
      const blob = [sp.name, sp.description, sp.higher_levels].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (lvls.length && !lvls.includes(String(sp.level))) return false;
    if (schools.length && !schools.includes(sp.school)) return false;
    if (classes.length && !classes.some(c => (sp.classes||[]).includes(c))) return false;
    if (tags.length && !tags.some(t => (sp.tags||[]).includes(t))) return false;
    if (onlyConc && !sp.concentration) return false;
    if (onlyRit && !sp.ritual) return false;
    if (onlyFavs && !FAVS.has(sp.id)) return false;
    if (cV && !sp.components?.v) return false;
    if (cS && !sp.components?.s) return false;
    if (cM && !sp.components?.m) return false;
    return true;
  });

  sortSpells(FILTERED, sortEl.value);
  listEl.innerHTML = FILTERED.map(renderCard).join('');
  attachCardEvents();
}

function valuesOfMulti(sel){
  return Array.from($(sel).selectedOptions || []).map(o => o.value);
}

function sortSpells(arr, mode){
  const byName = (a,b)=>a.name.localeCompare(b.name,'ru');
  const byLevel = (a,b)=>a.level-b.level || byName(a,b);
  const byTime = (a,b)=>timeOrder(a.casting_time)-timeOrder(b.casting_time) || byName(a,b);

  switch(mode){
    case 'name-asc': arr.sort(byName); break;
    case 'name-desc': arr.sort((a,b)=>-byName(a,b)); break;
    case 'level-asc': arr.sort(byLevel); break;
    case 'level-desc': arr.sort((a,b)=>-byLevel(a,b)); break;
    case 'time-asc': arr.sort(byTime); break;
  }
}

function timeOrder(s=''){
  s=s.toLowerCase();
  const order = ['реакция','бонусное','1 действие','1 раунд','1 минута','10 минут','1 час'];
  const idx = order.findIndex(x=>s.includes(x));
  return idx>=0?idx:order.length;
}

function renderCard(sp){
  const fav = FAVS.has(sp.id) ? '★' : '☆';
  const lvl = sp.level===0? 'Трюк' : `${sp.level} ур.`;
  const comps = [
    sp.components?.v?'V':null,
    sp.components?.s?'S':null,
    sp.components?.m?'M':null
  ].filter(Boolean).join('/');

  return `<article class="card" data-id="${sp.id}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <h3>${sp.name}</h3>
      <button class="icon btn-fav" title="В избранное">${fav}</button>
    </div>
    <div class="meta">${lvl} · ${ruSchool(sp.school)} · ${sp.casting_time} · ${sp.range} · ${sp.duration} ${comps?('· '+comps):''}</div>
    <div class="badges">${(sp.tags||[]).map(t=>`<span class="badge">${t}</span>`).join('')}</div>
    <button class="ghost btn-open">Описание</button>
  </article>`;
}

function attachCardEvents(){
  $$('#list .card').forEach(card=>{
    const id = card.getAttribute('data-id');
    card.querySelector('.btn-open').addEventListener('click', ()=>openModal(id));
    card.querySelector('.btn-fav').addEventListener('click', (e)=>toggleFav(id, e.currentTarget));
  });
}

function toggleFav(id, btn){
  if (FAVS.has(id)) FAVS.delete(id); else FAVS.add(id);
  localStorage.setItem('favs', JSON.stringify(Array.from(FAVS)));
  btn.textContent = FAVS.has(id) ? '★' : '☆';
  if ($('#favorites').checked) render();
}

function openModal(id){
  const sp = ALL.find(x=>x.id===id);
  if (!sp) return;
  $('#m-title').textContent = sp.name;
  $('#m-level').textContent = sp.level===0?'Трюк':`${sp.level} уровень`;
  $('#m-school').textContent = ruSchool(sp.school);
  $('#m-time').textContent = sp.casting_time;
  $('#m-range').textContent = sp.range;
  $('#m-duration').textContent = sp.duration;
  $('#m-badges').innerHTML = (sp.tags||[]).map(t=>`<span class="badge">${t}</span>`).join('');
  $('#m-desc').textContent = sp.description || '';
  $('#m-higher').textContent = sp.higher_levels ? `${sp.higher_levels}` : '';
  mFav.onclick = ()=>{
    toggleFav(sp.id, mFav);
    mFav.textContent = FAVS.has(sp.id) ? '★ В избранном' : '★ В избранное';
  };
  mFav.textContent = FAVS.has(sp.id) ? '★ В избранном' : '★ В избранное';
  mCopy.onclick = ()=>{
    const txt = `${sp.name}\n${sp.level===0?'Трюк':sp.level+' уровень'} · ${ruSchool(sp.school)}\n${sp.casting_time} · ${sp.range} · ${sp.duration}\n\n${sp.description}\n${sp.higher_levels?('\n'+sp.higher_levels):''}`;
    navigator.clipboard.writeText(txt).then(()=>toast('Описание скопировано'));
  };
  modal.showModal();
}

const DM_PRESETS = {
  'Соц. сцена': {tags:['Социальные'], level:[], school:[], conc:false, rit:false},
  'Осада/бой': {tags:['Атакующие','Контроль','Защитные'], level:[], school:[], conc:false, rit:false},
  'Разведка': {tags:['Разведка','Ютилити','Иллюзия'], level:[], school:['divination','illusion'], conc:false, rit:false},
  'Путешествие': {tags:['Перемещение','Ютилити'], level:[], school:[], conc:false, rit:false}
};

$('#btn-dm').addEventListener('click', ()=>{
  const menu = document.createElement('div');
  menu.style.position='fixed'; menu.style.top='56px'; menu.style.right='16px';
  menu.style.background='#121821'; menu.style.border='1px solid #223042'; menu.style.borderRadius='8px';
  for (const k of Object.keys(DM_PRESETS)) {
    const b = document.createElement('button');
    b.className='ghost'; b.textContent=k; b.style.display='block'; b.style.width='100%';
    b.onclick=()=>{applyPreset(DM_PRESETS[k]); menu.remove();};
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  setTimeout(()=>document.addEventListener('click', ()=>menu.remove(), {once:true}), 10);
});

function applyPreset(p){
  // clear
  ['#tags','#level','#school'].forEach(sel=>$(sel).selectedIndex=-1);
  // set tags
  const tagSel = $('#tags');
  Array.from(tagSel.options).forEach(o=>{if(p.tags.includes(o.value)) o.selected=true;});
  render();
}

mClose.addEventListener('click', ()=>modal.close());
modal.addEventListener('click', (e)=>{ if (e.target===modal) modal.close(); });

function toast(msg){
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.position='fixed'; t.style.bottom='16px'; t.style.left='50%'; t.style.transform='translateX(-50%)';
  t.style.background='#1a2330'; t.style.border='1px solid #223042'; t.style.padding='8px 12px'; t.style.borderRadius='8px';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),1400);
}

// Import/Export
$('#btn-export').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(ALL, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'spells-export.json';
  a.click();
});
$('#btn-import').addEventListener('click', ()=>{
  const inp = document.createElement('input');
  inp.type='file'; inp.accept='application/json';
  inp.onchange = async ()=>{
    const file = inp.files[0]; const txt = await file.text();
    try { ALL = JSON.parse(txt); render(); toast('Импортирован пользовательский список'); }
    catch { toast('Не удалось импортировать'); }
  };
  inp.click();
});

// events
const searchEl0 = $('#search');
searchEl0.addEventListener('input', render);
sortEl.addEventListener('change', render);
$('#btn-favs').addEventListener('click', ()=>{
  $('#favorites').checked = !$('#favorites').checked;
  render();
});
$('#btn-clear').addEventListener('click', ()=>{
  searchEl0.value='';
  ['#level','#school','#classes','#tags'].forEach(sel=>$(sel).selectedIndex=-1);
  ['concentration','ritual','favorites','compV','compS','compM'].forEach(id=>$('#'+id).checked=false);
  sortEl.value='level-asc';
  render();
});
$$('select[multiple]').forEach(sel=>sel.addEventListener('change', render));
['concentration','ritual','favorites','compV','compS','compM'].forEach(id=>$('#'+id).addEventListener('change', render));

load();
