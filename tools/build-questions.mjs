// tools/build-questions.mjs
import {promises as fs} from 'fs';
import path from 'path';

const IMG_DIR = 'images';
const OUT     = 'questions.json';
const ANSWERS_CSV = 'data/answers.csv';     // optional (full metadata)
const ANSWERS_MIN = 'data/answers_min.csv'; // optional (id/file + answer only)

const exts = new Set(['.jpg','.jpeg','.png','.webp']);
const toUnix = p => p.replace(/\\/g,'/');

async function walk(dir){
  const out = [];
  for (const e of await fs.readdir(dir, {withFileTypes:true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(toUnix(p));
  }
  return out;
}

function parseCSV(txt){
  const rows = txt.trim().split(/\r?\n/).map(r => r.split(',').map(s=>s.trim()));
  const cols = rows.shift();
  return rows.map(r => Object.fromEntries(cols.map((c,i)=>[c, r[i] ?? ''])));
}

function loadAnswerMap(csvRows){
  // CSV columns (optional): file,answer,section,explain
  const m = new Map();
  for (const row of csvRows) {
    const base = path.basename(row.file || '', path.extname(row.file || ''));
    m.set(base, {
      answer: Number(row.answer) || 1,
      section: row.section || 'type 2',
      explain: row.explain || ''
    });
  }
  return m;
}

function basenameNoExt(p){ return path.basename(p, path.extname(p)); }

/* ------------ Scan images ------------ */
const all = await walk(IMG_DIR);
// All non-solution images = questions
const questionsImgs = all.filter(p => !p.includes('/solutions/') && exts.has(path.extname(p).toLowerCase()));
// All images (used to find matching solutions)
const allImgs = all.filter(p => exts.has(path.extname(p).toLowerCase()));

/* ------------ Optional answers.csv metadata ------------ */
let answerMap = new Map();
try {
  const txt = await fs.readFile(ANSWERS_CSV, 'utf8');
  answerMap = loadAnswerMap(parseCSV(txt));
} catch { /* answers.csv optional */ }

function solutionsFor(base){
  const low = base.toLowerCase();
  return allImgs
    .filter(p => p.includes('/solutions/') && basenameNoExt(p).toLowerCase().startsWith(low + '-sol'))
    .sort();
}

/* ------------ Build questions from images ------------ */
const questions = [];
for (const p of questionsImgs.sort((a,b)=>a.localeCompare(b, undefined, {numeric:true}))) {
  const base = basenameNoExt(p);
  const sols = solutionsFor(base);
  const meta = answerMap.get(base) || {};
  const q = {
    id: `type2-${base}`,
    section: meta.section || 'type 2',
    text: `<img src="./${p}" style="max-width:100%;height:auto;">`,
    options: ["a","b","c","d"],
    answer: meta.answer ?? 1
  };
  if (sols.length) q.solution_images = sols.map(x => './' + x);
  if (meta.explain) q.solution_html = meta.explain;
  questions.push(q);
}

/* ------------ Minimal answer overrides with RANGE support (answers_min.csv) ------------ */
/*
  data/answers_min.csv supports rows like:
    # same answer for a range
    file,answer
    vu1..vu12,1

    # different answers across a short range (semicolon list)
    file,answers
    vu1..vu4,1;2;3;1

    # single items (basename or path; extension optional)
    file,answer
    vu13,2
    images/vu14.jpg,3

    # or by id:
    id,answer
    type2-vu21,1
*/
function toIndex(v){
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  if (n >= 0 && n <= 3) return n;     // 0..3 (a..d)
  if (n >= 1 && n <= 4) return n - 1; // 1..4 -> 0..3
  return null;
}
function baseNoExt(p){
  const b = path.basename((p||'').trim());
  return b.replace(/\.(jpeg|jpg|png|webp|heic|heif)$/i,'').toLowerCase();
}
// Expand "vu1..vu12" or "vu1-12" into ["vu1","vu2",...,"vu12"]
function expandToken(tok){
  const s = baseNoExt(tok);
  let m = s.match(/^([a-z0-9_\-]*?)(\d+)\.\.(\d+)$/i) || s.match(/^([a-z0-9_\-]*?)(\d+)-(\d+)$/i);
  if (!m) return [s];
  const [, prefix, a, b] = m;
  const start = parseInt(a,10), end = parseInt(b,10);
  const pad = a.length > 1 ? a.length : 0; // keep zero-padding if any
  const list = [];
  const step = start <= end ? 1 : -1;
  for (let i = start; step > 0 ? i <= end : i >= end; i += step){
    const num = pad ? String(i).padStart(pad,'0') : String(i);
    list.push((prefix + num).toLowerCase());
  }
  return list;
}
// Expand "vu1..vu12; vu15,vu18" -> array of basenames
function expandList(spec){
  return (spec||'')
    .split(/[;,]/).map(s=>s.trim()).filter(Boolean)
    .flatMap(expandToken);
}

try {
  const csv = await fs.readFile(ANSWERS_MIN,'utf8');
  const rows = parseCSV(csv);

  // Build lookup: basename (from question's <img src>) -> index in questions[]
  const byBase = new Map();
  questions.forEach((q,i)=>{
    const m = /src="\.?\/?([^"]+)"/.exec(q.text || '');
    if (m) byBase.set(baseNoExt(m[1]), i);
  });

  let applied = 0;
  for (const r of rows){
    // prefer id if provided
    const id = (r.id || '').trim();
    const singleAns = toIndex(r.answer);
    const seq = (r.answers || '')
                  .split(/[;, ]/).map(x=>x.trim()).filter(Boolean)
                  .map(toIndex).filter(v=>v!==null);

    if (id) {
      const idx = questions.findIndex(q => q.id === id);
      if (idx >= 0 && singleAns !== null) { questions[idx].answer = singleAns; applied++; }
      continue;
    }

    // else use file/range
    const filespec = (r.file || r.filename || '').trim();
    if (!filespec) continue;

    const bases = expandList(filespec); // ["vu1","vu2",...]
    if (!bases.length) continue;

    if (seq.length && seq.length === bases.length) {
      // one-to-one mapping across the range
      bases.forEach((b, k) => {
        const i = byBase.get(b);
        if (i != null) { questions[i].answer = seq[k]; applied++; }
      });
    } else if (singleAns !== null) {
      // same answer for all in the list/range
      bases.forEach(b => {
        const i = byBase.get(b);
        if (i != null) { questions[i].answer = singleAns; applied++; }
      });
    } else if (seq.length && seq.length !== bases.length) {
      console.warn('answers_min.csv: answers count does not match range length for', filespec);
    }
  }
  console.log(`answers_min.csv: applied ${applied} overrides`);
} catch { /* answers_min.csv optional */ }

/* ------------ Write output ------------ */
await fs.writeFile(OUT, JSON.stringify(questions, null, 2));
console.log(`Wrote ${questions.length} questions to ${OUT}`);
