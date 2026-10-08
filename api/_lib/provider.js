// The 3D step of Build my car (v16.0): the player's photos -> a textured 3D model (GLB), by Tripo's multiview model.
// Two ways to reach it, whichever key Morgan adds in Vercel (Settings -> Environment Variables; never in the code):
//   TRIPO_API_KEY : Tripo's own API (openapi.tripo3d.com), paid with Tripo credits
//   FAL_KEY       : fal.ai's copy of the same model (tripo3d/h3.1/multiview-to-3d), paid per car in dollars
// M67_3D picks one if both are set. M67_MOCK_DIR (testing only) "builds" one of the game's own cars instead.
import fs from 'node:fs/promises';
import path from 'node:path';

const VIEWS = ['front', 'left', 'back', 'right'];
const FACES = 70000; // (about what the rivals have before their wheels are cut out)

export function which() {
  const want = process.env.M67_3D;
  if (want === 'mock' || (!want && process.env.M67_MOCK_DIR && !process.env.TRIPO_API_KEY && !process.env.FAL_KEY)) return process.env.M67_MOCK_DIR ? 'mock' : null;
  if (want === 'tripo' || (!want && process.env.TRIPO_API_KEY)) return process.env.TRIPO_API_KEY ? 'tripo' : null;
  if (want === 'fal' || (!want && process.env.FAL_KEY)) return process.env.FAL_KEY ? 'fal' : null;
  return null;
}

async function call(url, opt, ms = 20000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, Object.assign({ signal: ac.signal }, opt)); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { }
    if (!r.ok) throw new Error(`3D service ${r.status}: ${(j && (j.message || j.detail || j.error)) || txt.slice(0, 160)}`);
    return j;
  } finally { clearTimeout(t); }
}

// photos: { front: url, left?: url, back?: url, right?: url } -> job (stored with the car)
export async function submit(photos, opts = {}) {
  const p = which(); if (!p) throw new Error('no 3D service set up');
  if (p === 'mock') return { p, kind: opts.mockKind || 'nova', t: Date.now() };
  if (p === 'tripo') {
    const inputs = VIEWS.filter(v => photos[v]).map(v => ({ [v]: photos[v] }));
    const j = await call('https://openapi.tripo3d.com/v3/generation/multiview-to-model', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.TRIPO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs, model: process.env.M67_TRIPO_MODEL || 'v3.1-20260211', face_limit: FACES, texture: true, pbr: true, texture_quality: 'standard', geometry_quality: 'standard', ...(opts.seed ? { model_seed: opts.seed, texture_seed: opts.seed } : {}) }),
    });
    const id = j && j.data && j.data.task_id; if (!id) throw new Error('3D service gave no task');
    return { p, id: String(id) };
  }
  // fal: the views go in order front, left, back, right (the front plus any run of the next ones)
  const list = []; for (const v of VIEWS) { if (!photos[v]) break; list.push(photos[v]); }
  const j = await call('https://queue.fal.run/tripo3d/h3.1/multiview-to-3d', {
    method: 'POST', headers: { Authorization: 'Key ' + process.env.FAL_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_urls: list, face_limit: FACES, texture: true, pbr: true, ...(opts.seed ? { model_seed: opts.seed, texture_seed: opts.seed } : {}) }),
  });
  const ok = (u) => typeof u === 'string' && /^https:\/\/queue\.fal\.run\//.test(u);
  if (!j || !ok(j.status_url) || !ok(j.response_url)) throw new Error('3D service gave no task');
  return { p, status: j.status_url, result: j.response_url };
}

// -> { state: 'running' | 'done' | 'failed', progress 0..1, model (url), preview (url), error }
export async function poll(job) {
  if (job.p === 'mock') { const k = Math.min(1, (Date.now() - job.t) / 8000); return k < 1 ? { state: 'running', progress: k } : { state: 'done', progress: 1, model: 'mock:' + job.kind }; }
  if (job.p === 'tripo') {
    const j = await call('https://openapi.tripo3d.com/v3/tasks/' + encodeURIComponent(job.id), { headers: { Authorization: 'Bearer ' + process.env.TRIPO_API_KEY } });
    const d = (j && j.data) || {}, st = String(d.status || '').toLowerCase(), out = d.output || {};
    if (st === 'success') return { state: 'done', progress: 1, model: out.model_url || out.pbr_model || out.model, preview: out.rendered_image_url || out.rendered_image };
    if (['failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(st)) return { state: 'failed', error: '3D service: ' + st };
    return { state: 'running', progress: Math.max(0, Math.min(1, (+d.progress || 0) / 100)) };
  }
  const s = await call(job.status, { headers: { Authorization: 'Key ' + process.env.FAL_KEY } });
  const st = String((s && s.status) || '');
  if (st === 'COMPLETED') {
    if (s.error) return { state: 'failed', error: '3D service: ' + String(s.error).slice(0, 160) };
    const r = await call(job.result, { headers: { Authorization: 'Key ' + process.env.FAL_KEY } });
    const m = r && r.model_mesh && r.model_mesh.url; if (!m) return { state: 'failed', error: '3D service: no model' };
    return { state: 'done', progress: 1, model: m, preview: r.rendered_image && r.rendered_image.url };
  }
  if (st === 'IN_QUEUE' || st === 'IN_PROGRESS') return { state: 'running', progress: st === 'IN_QUEUE' ? 0.05 : 0.4 };
  return { state: 'failed', error: '3D service: ' + (st || 'error') };
}

// the finished model (the service's links only last a few minutes, so it's fetched as soon as it's ready)
export async function fetchModel(url) {
  if (url.startsWith('mock:')) { const k = url.slice(5).replace(/[^a-z]/g, ''); return fs.readFile(path.join(process.env.M67_MOCK_DIR, k + '_s5.glb')); }
  if (!/^https:\/\//.test(url)) throw new Error('model link');
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 40000);
  try {
    const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('model download ' + r.status);
    const len = +(r.headers.get('content-length') || 0); if (len > 120e6) throw new Error('model too big');
    const chunks = []; let n = 0; for await (const c of r.body) { n += c.length; if (n > 120e6) throw new Error('model too big'); chunks.push(Buffer.from(c)); }
    return Buffer.concat(chunks);
  } finally { clearTimeout(t); }
}
export async function fetchPreview(url) {
  if (!url || !/^https:\/\//.test(url)) return null;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) return null; const b = Buffer.from(await r.arrayBuffer()); return b.length < 8e6 ? b : null; } catch { return null; }
}
