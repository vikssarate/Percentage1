// tools/build-questions.mjs
import { promises as fs } from 'fs';
import path from 'path';

/* ===== Config ===== */
const IMG_DIR      = 'images';
const SOL_DIR_NAME = 'solutions';            // inside IMG_DIR
const OUT          = 'questions.json';
const ANSWERS_CSV  = 'data/answers.csv';     // optional: rich metadata
const ANSWERS_MIN  = 'data/answers_min.csv'; // optional: quick overrides

/* ===== Helpers ===== */
const toUnix = (p) => p.replace(/\\/g, '/');
// Scan these file types (browsers best with jpg/png/webp; heic/heif for staging)
const exts   = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

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
  const rows = txt.trim().split(/\r?\n/).map(r => r.split(','));
  const cols = rows.shift().map(c => c.trim().toLowerCase());
  return rows.map(r => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

function splitList(s){
  return String(s || '')
    .split(/[;,]/).map(x => x.trim()).filter(Boolean);
}

function toIndex(v){
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const letters = ['a','b','c','d'];
  const li = letters.indexOf(s.toLowerCase());
  if (li !== -1) return li;
  const n = +s;
  if (!Number.isNaN(n)) {
    if (n >= 0 && n <= 3) return n;
    if (n >= 1 && n <= 4) return n - 1;
  }
  return null;
}

function baseNoExt(p){
  const b = path.basename((p||'').trim());
  return b.replace(/\.(jpeg|jpg|png|webp|heic|heif)$/i, '').toLowerCase();
}

// "images/Type 1/vu1.jpg" -> "Type 1"; "images/vu1.jpg" -> ""
function sectionFromPath(p){
  const rel = toUnix(p).replace(new RegExp(`^${IMG_DIR}/`, 'i'), '');
  const top = (rel.split('/')[0] || '').trim();
  if (!top || new RegExp(`^${SOL_DIR_NAME}$`, 'i').test(top)) return '';
  return top.replace(/[_-]+/g, ' ').trim();
}

/* ===== Auto-rename + auto-pair =====
   - Rename any question image that isn't already "vu<N>.*" to the next number
   - Rename orphan solution files to "<vuN>-sol.*" (or "-sol-2", "-sol-3", ...)
*/
async function autoRenameAndPairImages() {
  const all = await walk(IMG_DIR);
  const isImg = (p) => exts.has(path.extname(p).toLowerCase());
  const isSolution = (p) => new RegExp(`/${SOL_DIR_NAME}/`, 'i').test(p);
  const isQuestion = (p) => isImg(p) && !isSolution(p);

  const qFiles = all.filter(isQuestion);
  const sFiles = all.filter(p => isImg(p) && isSolution(p));

  // Find current global max "vuNN"
  const getVuNum = (s) => {
    const m = baseNoExt(s).match(/^vu(\d+)$/i) || baseNoExt(s).match(/^type\d+-vu(\d+)$/i);
    return m ? +m[1] : null;
  };
  let maxN = 0;
  for (const p of qFiles) {
    const n = getVuNum(p);
    if (n && n > maxN) maxN = n;
  }

  // 1) Rename question images not already normalized to vuNN.*
  const renamesQ = [];
  for (const p of qFiles.sort((a,b)=>a.localeCompare(b, undefined, { numeric:true }))) {
    const b = baseNoExt(p);
    if (/^vu\d+$/i.test(b) || /^type\d+-vu\d+$/i.test(b)) continue; // already normalized
    const next = ++maxN;
    const dest = toUnix(path.join(path.dirname(p), `vu${next}${path.extname(p).toLowerCase()}`));
    if (dest !== p) renamesQ.push([p, dest]);
  }
  for (const [from, to] of renamesQ) {
    await fs.rename(from, to);
  }

  // Refresh after question renames
  const after = await walk(IMG_DIR);
  const Qs = after.filter(isQuestion);
  const Sols = after.filter(p => isImg(p) && isSolution(p));

  // Map qBase -> existing solution paths
  const hasSols = new Map();
  for (const sp of Sols) {
    const bb = baseNoExt(sp);
    const m = bb.match(/^(vu\d+)(-sol(?:-\d+)?)$/i);
    if (m) {
      const key = m[1];
      if (!hasSols.has(key)) hasSols.set(key, []);
      hasSols.get(key).push(sp);
    }
  }

  // All normalized question bases, sorted by number
  const qBases = Qs.map(p => baseNoExt(p))
                   .filter(b => /^vu\d+$/i.test(b))
                   .sort((a,b) => +a.slice(2) - +b.slice(2));

  // 2) Rename orphan solution images (no "-sol" in their basename yet)
  const orphans = Sols.filter(p => !/-sol(\.|-)/i.test(path.basename(p)));

  // Track how many solutions each qBase has (existing + new assignments)
  const counts = new Map();
  for (const b of qBases) counts.set(b, (hasSols.get(b) || []).length);
  let idx = 0;

  for (const sp of orphans.sort((a,b)=>a.localeCompare(b, undefined, { numeric:true }))) {
    if (!qBases.length) break;
    const qBase = qBases[idx % qBases.length];
    const cur = counts.get(qBase) || 0;
    const suffix = cur === 0 ? '-sol' : `-sol-${cur+1}`;
    const dest = toUnix(path.join(path.dirname(sp), `${qBase}${suffix}${path.extname(sp).toLowerCase()}`));
    await fs.rename(sp, dest);
    counts.set(qBase, cur + 1);
    idx++;
  }
}

/* ===== answers.csv (rich metadata) =====
   Columns (any subset): file,id,section,text,answer,solution_images,video_link,video_links,link,explain
   - file: targets image by basename
   - id:   targets question id (e.g., type2-vu12)
*/
function loadAnswerMaps(csvRows){
  const byBase = new Map();
  const byId   = new Map();
  for (const row of csvRows) {
    const meta = {
      id:       (row.id || '').trim(),
      section:  row.section || '',
      text:     row.text || '',
      answer:   (toIndex(row.answer) ?? null),
      solution_images: splitList(row.solution_images || row.solution_image),
      video_links:     splitList(row.video_links || row.video_link || row.link),
      explain:  row.explain || row.solution_html || ''
    };
    const fileBase = row.file ? path.basename(row.file, path.extname(row.file)) : '';
    if (fileBase) byBase.set(fileBase, meta);
    if (meta.id)  byId.set(meta.id, meta);
  }
  return { byBase, byId };
}

/* ===== answers_min.csv (quick overrides) =====
   Supports:
     id,answer                     -> exact id
     file,answer                   -> same answer for list/range
     file,answers                  -> sequence mapped to the range
   file may be:
     "vu1..vu12", "vu1-12", "vu27", "images/vu28.jpg", "vu03,vu05"
*/
function expandToken(tok){
  const s = baseNoExt(tok);
  const m = s.match(/^([a-z0-9_\-]*?)(\d+)\.\.(\d+)$/i) || s.match(/^([a-z0-9_\-]*?)(\d+)-(\d+)$/i);
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

/* ===== Main ===== */
await autoRenameAndPairImages();

/* Build questions after renames */
const all = await walk(IMG_DIR);
const allImgs = all.filter(p => exts.has(path.extname(p).toLowerCase()));
const isSolution = (p) => new RegExp(`/${SOL_DIR_NAME}/`, 'i').test(p);
const questionsImgs = allImgs.filter(p => !isSolution(p));

/* Optional metadata from answers.csv */
let metaByBase = new Map();
let metaById   = new Map();
try {
  const txt = await fs.readFile(ANSWERS_CSV, 'utf8');
  const rows = parseCSV(txt);
  const maps = loadAnswerMaps(rows);
  metaByBase = maps.byBase;
  metaById   = maps.byId;
} catch {}

/* Find solutions for a given question base (e.g., "vu12") */
function solutionsFor(base){
  const low = base.toLowerCase();
  return allImgs
    .filter(p => isSolution(p) && baseNoExt(p).startsWith(low + '-sol'))
    .sort((a,b)=>a.localeCompare(b, undefined, { numeric:true }))
    .map(x => './' + x);
}

/* Assemble question list */
const questions = [];
for (const p of questionsImgs.sort((a,b)=>a.localeCompare(b, undefined, { numeric:true }))) {
  const base = baseNoExt(p);
  if (!/^vu\d+$/i.test(base)) continue; // only normalized images become questions

  const idAuto    = `type2-${base}`;
  const metaId    = metaById.get(idAuto) || null;
  const metaFile  = metaByBase.get(path.basename(p, path.extname(p))) || {};
  const meta      = metaId || metaFile;

  const folderSec = sectionFromPath(p);
  const sols      = solutionsFor(base);

  const q = {
    id:      meta.id || idAuto,
    section: meta.section || folderSec || 'type 2',
    text:    meta.text || `<img src="./${p}" style="max-width:100%;height:auto;">`,
    options: ['a','b','c','d'],
    answer:  (meta.answer ?? 1)
  };

  // Solution images: auto + CSV additions
  if (sols.length) q.solution_images = sols;
  if (meta.solution_images?.length) {
    q.solution_images = (q.solution_images || []).concat(
      meta.solution_images.map(x => (x.startsWith('.') || x.startsWith('/')) ? x : './' + x)
    );
  }

  // Solution videos (YouTube/Drive/MP4/etc.)
  if (meta.video_links?.length) q.solution_videos = meta.video_links;

  if (meta.explain) q.solution_html = meta.explain;

  questions.push(q);
}

/* Apply quick overrides (answers_min.csv) */
try {
  const txt = await fs.readFile(ANSWERS_MIN, 'utf8');
  const rows = parseCSV(txt);

  // Map: image basename (from <img src>) -> index in questions[]
  const byBase = new Map();
  questions.forEach((q, i) => {
    const m = /src="\.?\/?([^"]+)"/.exec(q.text || '');
    if (m) byBase.set(baseNoExt(m[1]), i);
  });

  let applied = 0;
  for (const r of rows){
    const id = (r.id || '').trim();
    const one = toIndex(r.answer);
    const seq = splitList(r.answers).map(toIndex).filter(v => v !== null);

    if (id) {
      const idx = questions.findIndex(q => (q.id || '') === id);
      if (idx >= 0 && one !== null) { questions[idx].answer = one; applied++; }
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
    } else if (one !== null) {
      bases.forEach(b => {
        const i = byBase.get(b);
        if (i != null) { questions[i].answer = one; applied++; }
      });
    }
  }
  console.log(`answers_min.csv overrides applied: ${applied}`);
} catch {}

/* Write output */
await fs.writeFile(OUT, JSON.stringify(questions, null, 2));
console.log(`Wrote ${questions.length} questions to ${OUT}`);
