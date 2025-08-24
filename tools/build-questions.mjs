// tools/build-questions.mjs
import {promises as fs} from 'fs';
import path from 'path';

const IMG_DIR     = 'images';
const OUT         = 'questions.json';
const ANSWERS_CSV = 'data/answers.csv';      // optional (full metadata per image)
const ANSWERS_MIN = 'data/answers_min.csv';  // optional (id/file + answer only)

// browsers render jpg/png/webp best; we still scan heic/heif if present
const exts   = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const toUnix = p => p.replace(/\\/g, '/');

async function walk(dir){
  const out = [];
  for (const e of await fs.readdir(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(toUnix(p));
  }
  return out;
}

function parseCSV(txt){
  const rows = txt.trim().split(/\r?\n/).map(r => r.split(',').map(s => s.trim()));
  const cols = rows.shift();
  return rows.map(r => Object.fromEntries(cols.map((c,i) => [c, r[i] ?? ''])));
}

// ---- helpers for answers & names ----
function toIndex(v){
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const letters = ['a','b','c','d'];
  const li = letters.indexOf(s.toLowerCase());
  if (li !== -1) return li;
  const n = Number(s);
  if (!Number.isNaN(n)) {
    if (n >= 0 && n <= 3) return n;
    if (n >= 1 && n <= 4) return n - 1;
  }
  return null;
}
function baseNoExt(p){
  const b = path.basename((p||'').trim());
  return b.replace(/\.(jpeg|jpg|png|webp|heic|heif)$/i,'').toLowerCase();
}
function loadAnswerMap(csvRows){
  // columns: file,answer,section,explain (all optional)
  const m = new Map();
  for (const row of csvRows) {
    const base = path.basename(row.file || '', path.extname(row.file || ''));
    m.set(base, {
      answer: (toIndex(row.answer) ?? 1),   // default to "b" if missing
      section: row.section || 'type 2',
      explain: row.explain || ''
    });
  }
  return m;
}

// ---- NEW: infer section name from folder path ----
function sectionFromPath(p){
  // p like "images/Type 1/vu1.jpg" or "images/vu1.jpg"
  const rel = toUnix(p).replace(/^images\//i, '');
  const top = (rel.split('/')[0] || '').trim();
  if (!top || /^solutions$/i.test(top)) return ''; // no section if at root or in solutions
  // normalize "type-1" -> "type 1"
  return top.replace(/[_-]+/g, ' ').trim();
}

/* ------------ Scan images ------------ */
const all = await walk(IMG_DIR);

// All non-solution images = questions
const questionsImgs = all.filter(p =>
  !/\/solutions\//i.test(p) && exts.has(path.extname(p).toLowerCase())
);

// All images (used to find matching solutions)
const allImgs = all.filter(p => exts.has(path.extname(p).toLowerCase()));

/* ------------ Optional answers.csv metadata ------------ */
let answerMap = new Map();
try {
  const txt = await fs.readFile(ANSWERS_CSV, 'utf8');
  answerMap = loadAnswerMap(parseCSV(txt));
} catch { /* optional */ }

function solutionsFor(base){
  const low = base.toLowerCase();
  return allImgs
    .filter(p => /\/solutions\//i.test(p) && baseNoExt(p).startsWith(low + '-sol'))
    .sort();
}

/* ------------ Build questions from images ------------ */
const questions = [];
for (const p of questionsImgs.sort((a,b)=>a.localeCompare(b, undefined, {numeric:true}))) {
  const base     = baseNoExt(p);
  const sols     = solutionsFor(base);
  const meta     = answerMap.get(path.basename(p, path.extname(p))) || {};
  const folderSec= sectionFromPath(p);         // ← infer from folder

  const q = {
    id:      `type2-${base}`,
    section: meta.section || folderSec || 'type 2',  // CSV > folder > default
    text:    `<img src="./${p}" style="max-width:100%;height:auto;">`,
    options: ['a','b','c','d'],
    answer:  (meta.answer ?? 1)
  };
  if (sols.length) q.solution_images = sols.map(x => './' + x);
  if (meta.explain) q.solution_html  = meta.explain;

  questions.push(q);
}

/* ------------ answers_min.csv overrides ------------- */
/*
  Supports:
    id,answer                    -> set by exact question id
    file,answer                  -> same answer for list/range
    file,answers                 -> sequence mapped to the range
  file may be:
    "vu1..vu12", "vu1-12", "vu27", "images/vu28.jpg", "vu03,vu05"
*/
function expandToken(tok){
  const s = baseNoExt(tok);
  let m = s.match(/^([a-z0-9_\-]*?)(\d+)\.\.(\d+)$/i) || s.match(/^([a-z0-9_\-]*?)(\d+)-(\d+)$/i);
  if (!m) return [s];
  const [, prefix, a, b] = m;
  const start = parseInt(a,10), end = parseInt(b,10);
  const pad = a.length > 1 ? a.length : 0;
  const list = [];
  const step = start <= end ? 1 : -1;
  for (let i = start; step > 0 ? i <= end : i >= end; i += step){
    const num = pad ? String(i).padStart(pad,'0') : String(i);
    list.push((prefix + num).toLowerCase());
  }
  return list;
}
function expandList(spec){
  return (spec||'')
    .split(/[;,]/).map(s=>s.trim()).filter(Boolean)
    .flatMap(expandToken);
}

try {
  const csv  = await fs.readFile(ANSWERS_MIN, 'utf8');
  const rows = parseCSV(csv);

  // lookup: basename from <img src> -> index in questions[]
  const byBase = new Map();
  questions.forEach((q,i)=>{
    const m = /src="\.?\/?([^"]+)"/.exec(q.text || '');
    if (m) byBase.set(baseNoExt(m[1]), i);
  });

  let applied = 0;
  for (const r of rows){
    const id = (r.id || '').trim();
    const singleAns = toIndex(r.answer);
    const seq = (r.answers || '')
      .split(/[;, ]/).map(x=>x.trim()).filter(Boolean)
      .map(toIndex).filter(v=>v!==null);

    if (id) {
      const idx = questions.findIndex(q => (q.id || '') === id);
      if (idx >= 0 && singleAns !== null) { questions[idx].answer = singleAns; applied++; }
      continue;
    }

    const filespec = (r.file || r.filename || '').trim();
    if (!filespec) continue;

    const bases = expandList(filespec);
    if (!bases.length) continue;

    if (seq.length && seq.length === bases.length) {
      bases.forEach((b, k) => {
        const i = byBase.get(b);
        if (i != null) { questions[i].answer = seq[k]; applied++; }
      });
    } else if (singleAns !== null) {
      bases.forEach(b => {
        const i = byBase.get(b);
        if (i != null) { questions[i].answer = singleAns; applied++; }
      });
    } else if (seq.length) {
      console.warn('answers_min.csv: answers count does not match range length for', filespec);
    }
  }
  console.log(`answers_min.csv: applied ${applied} overrides`);
} catch { /* optional */ }

/* ------------ Write output ------------ */
await fs.writeFile(OUT, JSON.stringify(questions, null, 2));
console.log(`Wrote ${questions.length} questions to ${OUT}`);
