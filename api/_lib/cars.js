// A player's car on the server (v16.0): its record (cars/<id>/meta.json), photos, the 3D service's raw models and the
// finished game data (cars/<id>/geo-<n>.json), plus the invite-code counters.
import sharp from 'sharp';
import crypto from 'node:crypto';
import { getJSON, putJSON, getBuf, putBuf } from './store.js';
import { submit, poll, fetchModel, fetchPreview, which } from './provider.js';
import { bakeCar } from './carbake.js';
import { defaults, clean } from './settings.js';
import { invites, codeHash, today, sha, safeEq } from './util.js';

export const VIEWS = ['front', 'left', 'back', 'right'];
export const metaPath = (id) => `cars/${id}/meta.json`;
export const loadMeta = (id) => getJSON(metaPath(id));
export const saveMeta = (m) => { m.updated = Date.now(); return putJSON(metaPath(m.id), m); };
export const keyOk = (m, key) => !!(m && key && safeEq(m.keyHash, sha(key)));

// what anyone may see (friends load cars by this): no keys, codes, jobs or photos
export function publicMeta(m) {
  return { id: m.id, name: m.name, owner: m.owner, size: m.size, state: m.state, cur: m.cur, preview: m.preview || null,
    versions: (m.versions || []).map(v => ({ v: v.v, g: v.g, at: v.at, note: v.note, settings: v.settings })), geos: (m.geos || []).map(g => g.g) };
}

// ---- invite codes: how many builds each may still start. A car remembers its code (as a hash) for Build it again.
function codeFromHash(hash) { for (const [c, cap] of invites()) if (codeHash(c) === hash) return [c, cap]; return null; }
export async function useInvite(code, hashIn) {
  let c, cap;
  if (hashIn) { const f = codeFromHash(hashIn); if (!f) return { ok: false, error: 'The invite code for this car has been switched off.' }; [c, cap] = f; }
  else { c = String(code || '').trim().toUpperCase(); cap = invites().get(c); }
  if (cap === undefined) return { ok: false, error: "That invite code isn't right." };
  const h = codeHash(c), p = `invites/${h}.json`, rec = (await getJSON(p)) || { used: 0 };
  if (rec.used >= cap) return { ok: false, error: 'That invite code has used all its builds.' };
  // a cap on the whole site per day too, so a leaked code can't run up a bill
  const dp = `daily/${today()}.json`, day = (await getJSON(dp)) || { builds: 0, edits: 0 }, dayCap = +(process.env.M67_BUILDS_PER_DAY || 40);
  if (day.builds >= dayCap) return { ok: false, error: 'Car building is busy today. Please try again tomorrow.' };
  rec.used++; day.builds++; await putJSON(p, rec); await putJSON(dp, day);
  return { ok: true, hash: h, left: cap - rec.used };
}
export async function refundInvite(hash) { const p = `invites/${hash}.json`, rec = await getJSON(p); if (rec && rec.used > 0) { rec.used--; await putJSON(p, rec); } }
export async function inviteLeft(hash) { const f = codeFromHash(hash); if (!f) return 0; const rec = (await getJSON(`invites/${hash}.json`)) || { used: 0 }; return Math.max(0, f[1] - rec.used); }

// ---- photos: anything the player sends is decoded and saved again as a plain JPEG (no hidden data, no location tags)
export async function cleanPhoto(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Photos must be JPEG, PNG or WebP pictures.');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 3.2e6) throw new Error('A photo is too big.');
  const sig = buf.subarray(0, 12).toString('hex');
  if (!(sig.startsWith('ffd8ff') || sig.startsWith('89504e47') || (sig.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP'))) throw new Error("A photo isn't a picture file.");
  const img = sharp(buf, { limitInputPixels: 40e6 }).rotate();
  const md = await img.metadata(); if (!md.width || md.width < 200 || md.height < 200) throw new Error('A photo is too small (at least 200 pixels).');
  return img.resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
}

// ---- start the 3D step for a car whose photos are saved (a first build, or Build it again)
export async function startJob(m, origin) {
  m.photoToken = crypto.randomBytes(16).toString('hex'); m.photoUntil = Date.now() + 20 * 60e3;
  const urls = {}; for (const v of m.views) urls[v] = `${origin}/api/car/photo?id=${m.id}&view=${v}&t=${m.photoToken}`;
  m.job = await submit(urls, { seed: m.builds > 1 ? 1000 + m.builds : undefined, mockKind: m.mockKind });
  m.state = 'building'; m.msg = 'Making the 3D model'; m.progress = 0.02; m.jobAt = Date.now(); m.provider = m.job.p;
  await saveMeta(m);
}

// ---- move a building car along (called by status polls): when the 3D model is ready, fetch it and make the game car
export async function advance(m) {
  if (m.state === 'processing' && Date.now() - (m.procAt || 0) < 90e3) return m;
  if (m.state !== 'building' && m.state !== 'processing') return m;
  if (m.state === 'processing' && m.rawJob === m.jobAt) return finish(m, m.raws, null);   // (a bake that was cut off: its model is saved)
  if (Date.now() - (m.jobAt || 0) > 40 * 60e3) { m.state = 'failed'; m.msg = 'The 3D step took too long. Try Build it again.'; await saveMeta(m); return m; }
  let r;
  try { r = await poll(m.job); } catch (e) { m.msg = 'Waiting for the 3D service'; return m; }
  if (r.state === 'running') { m.progress = Math.max(m.progress || 0, 0.02 + 0.83 * r.progress); m.msg = r.progress > 0.05 ? 'Making the 3D model' : 'Waiting in line for the 3D service'; return m; }
  if (r.state === 'failed') { m.state = 'failed'; m.msg = "The 3D service couldn't build this one. Try clearer photos (the whole car, plain background)."; m.err = r.error; if (m.lastCharge) await refundInvite(m.lastCharge); m.lastCharge = null; await saveMeta(m); return m; }
  // done: claim the processing, fetch, bake
  m.state = 'processing'; m.procAt = Date.now(); m.msg = 'Fitting wheels and paint'; m.progress = 0.88; await saveMeta(m);
  let n;
  try {
    const glb = await fetchModel(r.model);
    n = (m.raws || 0) + 1; await putBuf(`cars/${m.id}/raw-${n}.glb`, glb, 'model/gltf-binary'); m.raws = n; m.rawJob = m.jobAt; await saveMeta(m);
  } catch (e) { m.state = 'failed'; m.msg = "Couldn't fetch the 3D model. Try Build it again."; m.err = String(e && e.message || e).slice(0, 200); if (m.lastCharge) await refundInvite(m.lastCharge); m.lastCharge = null; await saveMeta(m); return m; }
  return finish(m, n, r.preview);
}
async function finish(m, n, previewUrl) {
  m.procAt = Date.now(); m.state = 'processing';
  try {
    if (previewUrl && !m.preview) { const pv = await fetchPreview(previewUrl); if (pv) m.preview = 'data:image/webp;base64,' + (await sharp(pv).resize(320, 240, { fit: 'cover' }).webp({ quality: 72 }).toBuffer()).toString('base64'); }
    const prev = m.versions && m.versions.length ? m.versions.find(v => v.v === m.cur).settings : defaults(m.size);
    await makeGeo(m, n, prev, m.versions && m.versions.length ? 'Built again' : 'First build');
    m.state = 'ready'; m.msg = 'Ready'; m.progress = 1; m.lastCharge = null; m.job = null; m.photoToken = null; m.rawJob = null;
  } catch (e) { m.state = 'failed'; m.msg = 'Something went wrong making the game car. Try Build it again.'; m.err = String(e && e.message || e).slice(0, 200); if (m.lastCharge) await refundInvite(m.lastCharge); m.lastCharge = null; }
  await saveMeta(m);
  return m;
}

// bake raw model n with these settings into a new geo, and add a version that uses it
export async function makeGeo(m, raw, settings, note) {
  const glb = await getBuf(`cars/${m.id}/raw-${raw}.glb`); if (!glb) throw new Error('raw model missing');
  const { data, info } = await bakeCar(glb, { length: settings.length, flip: settings.flip });
  const g = (m.geos || []).reduce((a, x) => Math.max(a, x.g), 0) + 1;
  data.id = m.id; data.g = g;
  await putBuf(`cars/${m.id}/geo-${g}.json`, Buffer.from(JSON.stringify(data)), 'application/json');
  m.geos = (m.geos || []).concat([{ g, raw, at: Date.now(), info: { paint: info.paint, notes: info.notes, tris: info.triangles } }]);
  const s = clean(Object.assign({}, settings), defaults(m.size));
  if (!m.paintHex) m.paintHex = info.paint;
  addVersion(m, g, s, note);
}
export function addVersion(m, g, settings, note) {
  m.versions = m.versions || [];
  const v = m.versions.reduce((a, x) => Math.max(a, x.v), 0) + 1;
  m.versions.push({ v, g, at: Date.now(), note: String(note || '').slice(0, 120), settings });
  if (m.versions.length > 40) m.versions.splice(1, m.versions.length - 40); // (keep the first and the latest 39)
  m.cur = v; return v;
}
export const providerReady = () => !!which();
