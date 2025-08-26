// tools/build-questions.mjs
import { promises as fs } from 'fs';
import path from 'path';

const IMG_DIR      = 'images';
const OUT          = 'questions.json';
const ANSWERS_CSV  = 'data/answers.csv';      // optional: rich metadata
const ANSWERS_MIN  = 'data/answers_min.csv';  // optional: lightweight overrides

// Image types to scan
const exts   = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const toUnix = (p) => p.replace(/\\/g, '/');

/* -------------------------------- IO -------------------------------- */
async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(toUnix(p));
  }
  return out;
}

/* ---------------------------- CSV parsing ---------------------------- */
/** Split a CSV line by commas while respecting double quotes. */
function splitCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }  // escaped quote
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map(s => s.trim().replace(/^\uFEFF/, '')); // strip BOM if any
}

/** Parse CSV text into array of objects using header row. */
function parseCSV(txt) {
  const lines = txt.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cells[j] ?? '').trim();
    rows.push(row);
  }
  return rows;
}

/* ----------------------------- helpers ------------------------------ */
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
  const b = path.basename((p || '').trim());
  return b.replace(/\.(jpeg|jpg|png|webp|heic|heif)$/i, '').toLowerCase();
}
function splitList(s){
  return String(s || '')
    .split(/[;,]/)
    .map(x => x.trim())
    .filter(Boolean);
}
// Section from top folder: "images/Type 1/vu1.jpg" -> "Type 1"
function sectionFromPath(p){
  const rel = toUnix(p).replace(/^images\//i, '');
  const top = (rel.split('/')[0] || '').trim();
  if (!top || /^solutions$/i.test(top)) return '';
  return top.replace(/[_-]+/g, ' ').trim();
}

/**
 * Load optional metadata from answers.csv
 * Columns supported (use any subset):
 *   file,id,answer,section,text,explain,solution_images,video_link,video_links,link
 * Multiple URLs in a cell can be separated by comma or semicolon.
 */
function loadAnswerMaps(csvRows){
  const byBase = new Map();
  const byId   = new Map();
  for (const row of csvRows) {
    const meta = {
      answer:  (toIndex(row.answer) ?? 1),
      section: row.section || '',
      text:    row.text || '',
      explain: row.explain || row.solution_html || '',
      solution_images: splitList(row.solution_images || row.solution_image),
      video_links:     splitList(row.video_links || row.video_link || row.link)
    };
    const fileBase = row.file ? path.basename(row.file, path.extname(row.file)) : '';
    const idKey    = (row.id || '').trim();
    if (fileBase) byBase.set(fileBase, meta);
    if (idKey)    byId.set(idKey, meta);
  }
  return { byBase, byId };
}

/* ------------------------------ main -------------------------------- */
const all = await walk(IMG_DIR);

// All non-solution images = questions
const questionsImgs = all.filter(p =>
  !/\/solutions\//i.test(p) && exts.has(path.extname(p).toLowerCase())
);
// For solution image lookups
const allImgs = all.filter(p => exts.has(path.extname(p).toLowerCase()));

let metaByBase = new Map();
let metaById   = new Map();
try {
  const txt = await fs.readFile(ANSWERS_CSV, 'utf8');
  const rows = parseCSV(txt);
  const maps = loadAnswerMaps(rows);
  metaByBase = maps.byBase;
  metaById   = maps.byId;
} catch {
  // answers.csv is optional
}

function solutionsFor(base){
  const low = base.toLowerCase();
  return allImgs
    .filter(p => /\/solutions\//i.test(p) && baseNoExt(p).startsWith(low + '-sol'))
    .sort();
}

const questions = [];
for (const p of questionsImgs.sort((a,b)=>a.localeCompare(b, undefined, { numeric:true }))) {
  const base       = baseNoExt(p);
  const sols       = solutionsFor(base);
  const computedId = `type2-${base}`;

  const metaId   = metaById.get(computedId) || null;
  const metaFile = metaByBase.get(path.basename(p, path.extname(p))) || {};
  const meta     = metaId || metaFile;

  const folderSec = sectionFromPath(p);

  const q = {
    id:      computedId,
    section: meta.section || folderSec || 'type 2',
    text:    meta.text ? meta.text : `<img src="./${p}" style="max-width:100%;height:auto;">`,
    options: ['a','b','c','d'],
    answer:  (meta.answer ?? 1)
  };

  // Solution images: auto-discovered + CSV-specified
  if (sols.length) q.solution_images = sols.map(x => './' + x);
  if (meta.solution_images && meta.solution_images.length) {
    q.solution_images = (q.solution_images || []).concat(
      meta.solution_images.map(x => (x.startsWith('./') || x.startsWith('/')) ? x : './' + x)
    );
  }

  // Solution videos from CSV (YouTube, Drive, MP4, etc.)
  if (meta.video_links && meta.video_links.length) q.solution_videos = meta.video_links;

  if (meta.explain) q.solution_html = meta.explain;

  questions.push(q);
}

/* ----------------------- answers_min overrides ---------------------- */
/*
   Supports:
     id,answer                     -> set by exact question id
     file,answer                   -> same answer for list/range
     file,answers                  -> sequence mapped to the range
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
  const csv  = await fs.readFile(ANSWERS_MIN, 'utf8');
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
    const seq = splitList(r.answers || '').map(toIndex).filter(v => v !== null);

    if (id) {
      const idx = questions.findIndex(q => (q.id || '').trim() === id);
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
    } else if (seq.length && seq.length !== bases.length) {
      console.warn('answers_min.csv: answers count does not match range length for', filespec);
    }
  }
  console.log(`answers_min.csv: applied ${applied} overrides`);
} catch { /* optional */ }

/* ---------------------------- write out ----------------------------- */
await fs.writeFile(OUT, JSON.stringify(questions, null, 2));
console.log(`Wrote ${questions.length} questions to ${OUT}`);
