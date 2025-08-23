// tools/build-questions.mjs
import {promises as fs} from 'fs';
import path from 'path';

const IMG_DIR    = 'images';
const OUT        = 'questions.json';
const ANSWERS_CSV = 'data/answers.csv';      // optional (full metadata per image)
const ANSWERS_MIN = 'data/answers_min.csv';  // optional (id/file + answer only)

// Note: browsers typically don't render .heic/.heif; these are here so the
// builder can see them if you keep originals. Prefer JPG/PNG/WEBP for web.
const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const toUnix = p => p.replace(/\\/g,'/');

async function walk(dir){
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
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

// --- helpers for answer parsing and basenames ---
function toIndex(v){
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.toLowerCase();

  // Allow letters a..d
  const letters = ['a','b','c','d'];
  const li = letters.indexOf(m);
  if (li !== -1) return li;

  // Allow numbers 0..3 or 1..4
  const n = Number(s);
  if (!Number.isNaN(n)) {
    if (n >= 0 && n <= 3) return n;
    if (n >= 1 && n <= 4) return n - 1;
  }
  return null;
}

function baseNoExt(p){
  const b = path.basename((p || '').trim());
  return b.replace(/\.(jpeg|jpg|png|webp|heic|heif)$/i, '').toLowerCase();
}

function loadAnswerMap(csvRows){
  // CSV columns supported here: file, answer, section, explain
  // (Used for per-image metadata; answer is parsed via toIndex)
  const m = new Map();
  for (const row of csvRows) {
    const base = path.basename(row.file || '', path.extname(row.file || ''));
    m.set(base, {
      answer: (toIndex(row.answer) ?? 1),  // default to 1 (i.e., “b”) if missing
      section: row.section || 'type 2',
      explain: row.explain || ''
    });
  }
  return m;
}

/* ------------ Scan images ------------ */
const all = await walk(IMG_DIR);

// All non-solution images = questions
const questionsImgs = all.filter(p =>
  !p.includes('/solutions/') && exts.has(path.extname(p).toLowerCase())
);

// All images (used to find matching solutions)
const allImgs = all.filter(p => exts.has(path.extname(p).toLowerCase()));

/* ------------ Optional answers.csv metadata ------------ */
let answerMap = new Map();
try {
  const txt = await fs.readFile(ANSWERS_CSV, 'utf8');
  answerMap = loadAnswerMap(parseCSV(txt));
} catch {
  // answers.csv is optional
}

function solutionsFor(base){
  const low = base.toLowerCase();
  return allImgs
    // Any file under /solutions/ starting with the same basename + "-sol"
    .filter(p =>
      p.includes('/solutions/') &&
      baseNoExt(p).startsWith(low + '-sol')
    )
    .sort();
}

/* ------------ Build questions from images ------------ */
const questions = [];
for (const p of questionsImgs.sort((a,b) => a.localeCompare(b, undefined, { numeric: true }))) {
  const base = baseNoExt(p);
  const sols = solutionsFor(base);
  const meta = answerMap.get(path.basename(p, path.extname(p))) || {};

  const q = {
    id: `type2-${base}`,
    section: meta.section || 'type 2',
    text: `<img src="./${p}" style="max-width:100%;height:auto;">`,
    options: ['a','b','c','d'],
    answer: (meta.answer ?? 1)
  };

  if (sols.length) q.solution_images = sols.map(x => './' + x);
  if (meta.explain) q.solution_html = meta.explain;

  questions.push(q);
}

/* ------------ Minimal answer overrides (answers_min.csv) ------------
   Supports:
     id,answer                     -> set answer by exact question id
     file,answer                   -> same answer for list/range of basenames
     file,answers                  -> sequence mapped to the range
   file may be:
     "vu1..vu12", "vu1-12", "vu27", "images/vu28.jpg", "vu03,vu05"
-------------------------------------------------------------------- */
function expandToken(tok){
  const s = baseNoExt(tok);
  let m = s.match(/^([a-z0-9_\-]*?)(\d+)\.\.(\d+)$/i) || s.match(/^([a-z0-9_\-]*?)(\d+)-(\d+)$/i);
  if (!m) return [s];
  const [, prefix, a, b] = m;
  const start = parseInt(a,10), end = parseInt(b,10);
  const pad = a.length > 1 ? a.length : 0; // preserve zero padding if present
  const list = [];
  const step = start <= end ? 1 : -1;
  for (let i = start; step > 0 ? i <= end : i >= end; i += step){
    const num = pad ? String(i).padStart(pad, '0') : String(i);
    list.push((prefix + num).toLowerCase());
  }
  return list;
}
function expandList(spec){
  return (spec || '')
    .split(/[;,]/).map(s => s.trim()).filter(Boolean)
    .flatMap(expandToken);
}

try {
  const csv = await fs.readFile(ANSWERS_MIN, 'utf8');
  const rows = parseCSV(csv);

  // Map: question image basename -> index in questions[]
  const byBase = new Map();
  questions.forEach((q, i) => {
    const m = /src="\.?\/?([^"]+)"/.exec(q.text || '');
    if (m) byBase.set(baseNoExt(m[1]), i);
  });

  let applied = 0;

  for (const r of rows){
    const id = (r.id || '').trim();
    const singleAns = toIndex(r.answer);
    const seq = (r.answers || '')
      .split(/[;, ]/).map(x => x.trim()).filter(Boolean)
      .map(toIndex).filter(v => v !== null);

    // 1) ID-based (works for text questions too)
    if (id) {
      const idx = questions.findIndex(q => (q.id || '').trim() === id);
      if (idx >= 0 && singleAns !== null) {
        questions[idx].answer = singleAns;
        applied++;
      }
      continue; // skip file logic if id was provided
    }

    // 2) File/list/range based
    const filespec = (r.file || r.filename || '').trim();
    if (!filespec) continue;

    const bases = expandList(filespec);
    if (!bases.length) continue;

    if (seq.length && seq.length === bases.length) {
      // Map 1:1 sequence across the range/list
      bases.forEach((b, k) => {
        const i = byBase.get(b);
        if (i != null) { questions[i].answer = seq[k]; applied++; }
      });
    } else if (singleAns !== null) {
      // Same answer to all in the range/list
      bases.forEach(b => {
        const i = byBase.get(b);
        if (i != null) { questions[i].answer = singleAns; applied++; }
      });
    } else if (seq.length && seq.length !== bases.length) {
      console.warn('answers_min.csv: answers count does not match range length for', filespec);
    }
  }

  console.log(`answers_min.csv: applied ${applied} overrides`);
} catch {
  // answers_min.csv is optional
}

/* ------------ Write output ------------ */
await fs.writeFile(OUT, JSON.stringify(questions, null, 2));
console.log(`Wrote ${questions.length} questions to ${OUT}`);
