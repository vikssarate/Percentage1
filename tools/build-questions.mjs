// tools/build-questions.mjs
import { promises as fs } from 'fs';
import path from 'path';

const IMG_DIR      = 'images';
const OUT          = 'questions.json';
const ANSWERS_CSV  = 'data/answers.csv';      // optional: full metadata per image/id
const ANSWERS_MIN  = 'data/answers_min.csv';  // optional: id/file answer overrides

// Browsers render jpg/png/webp best; we still scan heic/heif if present
const exts   = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const toUnix = (p) => p.replace(/\\/g, '/');

async function walk(dir) {
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

/* ---------------- helpers ---------------- */
function toIndex(v){
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  // letters a..d
  const letters = ['a','b','c','d'];
  const li = letters.indexOf(s.toLowerCase());
  if (li !== -1) return li;

  // 0..3 or 1..4
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
// Infer section name from folder path (e.g., "images/Type 1/vu1.jpg" → "Type 1")
function sectionFromPath(p){
  const rel = toUnix(p).replace(/^images\//i, '');
  const top = (rel.split('/')[0] || '').trim();
  if (!top || /^solutions$/i.test(top)) return '';
  return top.replace(/[_-]+/g, ' ').trim();
}

/**
 * Load optional metadata from answers.csv
 * Supports columns (all optional):
 *   file,id,answer,section,text,explain,solution_images,video_link|video_links|link
 * Returns both byBase (keyed by file basename) and byId maps.
 */
function loadAnswerMaps(csvRows){
  const byBase = new Map();
  const byId   = new Map();

  for (const row of csvRows) {
    const meta = {
      answer:  (toIndex(row.answer) ?? 1), // default to "b"
      section: row.section || '',
      text:    row.text || '',
      explain: row.explain || row.solution_html || '',
      solution_images: splitList(row.solution_images),
      video_links:     splitList(row.video_links || row.video_link || row.link)
    };

    const fileBase = row.file ? path.basename(row.file, path.extname(row.file)) : '';
    const idKey    = (row.id || '').trim();

    if (fileBase) byBase.set(fileBase, meta);
    if (idKey)    byId.set(idKey, meta);
  }
  return { byBase, byId };
}

/* ------------ scan images ------------ */
const all = await walk(IMG_DIR);

// All non-solution images = questions
const questionsImgs = all.filter(p =>
  !/\/solutions\//i.test(p) && exts.has(path.extname(p).toLowerCase())
);

// All images (used to find matching solutions)
const allImgs = all.filter(p => exts.has(path.extname(p).toLowerCase()));

/* ------------ optional answers.csv metadata ------------ */
let metaByBase = new Map();
let metaById   = new Map();
try {
  const txt = await fs.readFile(ANSWERS_CSV, 'utf8');
  const maps = loadAnswerMaps(parseCSV(txt));
  metaByBase = maps.byBase;
  metaById   = maps.byId;
} catch { /* answers.csv is optional */ }

function solutionsFor(base){
  const low = base.toLowerCase();
  return allImgs
    .filter(p => /\/solutions\//i.test(p) && baseNoExt(p).startsWith(low + '-sol'))
    .sort();
}

/* ------------ build questions ------------ */
const questions = [];
for (const p of questionsImgs.sort((a,b) => a.localeCompare(b, undefined, { numeric: true }))) {
  const base      = baseNoExt(p);
  const sols      = solutionsFor(base);
  const computedId= `type2-${base}`;
  // Prefer id-based metadata (exact match), else file/basename-based
  const metaId    = metaById.get(computedId) || null;
  const metaFile  = metaByBase.get(path.basename(p, path.extname(p))) || {};
  const meta      = metaId || metaFile;

  const folderSec = sectionFromPath(p);

  const q = {
    id:      computedId,
    section: meta.section || folderSec || 'type 2',
    text:    meta.text ? meta.text : `<img src="./${p}" style="max-width:100%;height:auto;">`,
    options: ['a','b','c','d'],
    answer:  (meta.answer ?? 1)
  };

  // Images: discovered + CSV-provided (accept absolute/relative)
  if (sols.length) q.solution_images = sols.map(x => './' + x);
  if (meta.solution_images?.length) {
    q.solution_images = (q.solution_images || []).concat(
      meta.solution_images.map(x => (x.startsWith('./') || x.startsWith('/')) ? x : './' + x)
    );
  }

  // NEW: video links from CSV → solution_videos
  if (meta.video_links?.length) q.solution_videos = meta.video_links;

  if (meta.explain) q.solution_html = meta.explain;

  questions.push(q);
}

/* ------------ answers_min.csv overrides ------------ */
/*
   Supports:
     id,answer                     -> set answer by exact question id
     file,answer                   -> same answer for list/range of basenames
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
      continue;
    }

    // 2) File/list/range based
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

/* ------------ write output ------------ */
await fs.writeFile(OUT, JSON.stringify(questions, null, 2));
console.log(`Wrote ${questions.length} questions to ${OUT}`);
