// tools/build-questions.mjs
import {promises as fs} from 'fs';
import path from 'path';

const IMG_DIR = 'images';
const OUT     = 'questions.json';
const ANSWERS_CSV = 'data/answers.csv';     // optional (see below)

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
    const base = path.basename(row.file, path.extname(row.file));
    m.set(base, {
      answer: Number(row.answer) || 1,
      section: row.section || 'type 2',
      explain: row.explain || ''
    });
  }
  return m;
}

function basenameNoExt(p){ return path.basename(p, path.extname(p)); }

const all = await walk(IMG_DIR);
// All non-solution images = questions
const questionsImgs = all.filter(p => !p.includes('/solutions/') && exts.has(path.extname(p).toLowerCase()));
// All images (used to find matching solutions)
const allImgs = all.filter(p => exts.has(path.extname(p).toLowerCase()));

let answerMap = new Map();
try {
  const txt = await fs.readFile(ANSWERS_CSV, 'utf8');
  answerMap = loadAnswerMap(parseCSV(txt));
} catch { /* answers.csv is optional */ }

function solutionsFor(base){
  const low = base.toLowerCase();
  return allImgs
    .filter(p => p.includes('/solutions/') && basenameNoExt(p).toLowerCase().startsWith(low + '-sol'))
    .sort();
}

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

await fs.writeFile(OUT, JSON.stringify(questions, null, 2));
console.log(`Wrote ${questions.length} questions to ${OUT}`);
