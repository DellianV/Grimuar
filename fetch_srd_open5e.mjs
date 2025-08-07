// scripts/fetch_srd_open5e.mjs
// Fetch full SRD spells from Open5e at build time and write to data/spells.json
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const outPath = path.resolve('data/spells.json');

function slugify(x){return x.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');}
const ru = s=>s; // placeholder, UI is RU; names remain EN (lawful SRD).

function ruSchool(s){
  const map={
    abjuration:'abjuration',conjuration:'conjuration',divination:'divination',
    enchantment:'enchantment',evocation:'evocation',illusion:'illusion',
    necromancy:'necromancy',transmutation:'transmutation'
  };
  return map[s]||String(s||'').toLowerCase();
}

function deriveEffects(desc){
  const t = String(desc||'').toLowerCase();
  const fx = [];
  if (/\bdamage\b|\b1d|2d|3d|4d|5d/.test(t)) fx.push('damage');
  if (/ac\b|shield|cover/.test(t)) fx.push('ac_up');
  if (/heal|hit points|regain/.test(t)) fx.push('heal');
  if (/paraly|restrain|stun|blind|deafen|charm|frighten|banish|hold/.test(t)) fx.push('control');
  if (/teleport|fly|misty|dimension door|move/.test(t)) fx.push('movement');
  if (/detect|identify|see|scry/.test(t)) fx.push('scout');
  if (/invisible|light|clean|message|mend|shape water/.test(t)) fx.push('utility');
  return fx;
}

function synthSummary(s){
  const lvl = s.level_int ?? Number((s.level||'0').match(/\d/)?.[0]||0);
  const school = s.school||'';
  const time = s.casting_time||'';
  const rng = s.range||'';
  const dur = s.duration||'';
  let line = `${lvl===0?'Трюк':lvl+' ур.'} · ${school} · ${time} · ${rng} · ${dur}`;
  return line;
}

async function main(){
  const out = [];
  let url = 'https://api.open5e.com/spells/?document__slug=wotc-srd&limit=2000';
  while (url) {
    const r = await fetch(url);
    const j = await r.json();
    for (const s of j.results) {
      const classes = (s.dnd_class || s.classes || '').toLowerCase().replace(/\s/g,'').split(',').filter(Boolean);
      const comps = String(s.components||'').toUpperCase();
      out.push({
        id: slugify(s.name),
        name: s.name,
        level: s.level_int ?? Number((s.level||'0').match(/\d/)?.[0]||0),
        school: ruSchool(s.school),
        classes,
        casting_time: s.casting_time || '',
        range: s.range || '',
        components: {v:/V/.test(comps), s:/S/.test(comps), m:/M/.test(comps)},
        duration: s.duration || '',
        concentration: /concentration/i.test(s.concentration||s.duration||'') || s.concentration === true,
        ritual: /ritual/i.test(s.ritual||'') || /ritual/i.test(s.duration||''),
        damage: null,
        save: null,
        description: synthSummary(s),
        higher_levels: (s.higher_level||'').trim()?('При усилении: '+s.higher_level):null,
        source: 'SRD 5.1',
        tags: [],
        notes: '',
        effects: deriveEffects(s.desc)
      });
    }
    url = j.next;
  }
  await fs.promises.mkdir(path.dirname(outPath), {recursive:true});
  await fs.promises.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${out.length} spells -> ${outPath}`);
}

main().catch(e=>{console.error(e); process.exit(1);});
