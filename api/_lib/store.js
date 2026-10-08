// Storage for Build my car (v16.0): a private Vercel Blob store on the site (photos, the 3D service's models, the
// finished cars, the small records). Nothing in it is public: the game reads cars only through api/car/meta and
// api/car/geo. For testing on a computer, M67_STORE_DIR keeps the same files in a folder instead.
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = process.env.M67_STORE_DIR;
let blob = null;
const B = async () => blob || (blob = await import('@vercel/blob'));
const safe = (p) => { if (!/^[a-z0-9][a-z0-9/_.-]{0,120}$/.test(p) || p.includes('..')) throw new Error('bad path'); return p; };

export async function getBuf(p, fresh = true) {
  safe(p);
  if (DIR) { try { return await fs.readFile(path.join(DIR, p)); } catch { return null; } }
  const { get } = await B();
  const r = await get(p, { access: 'private', useCache: !fresh }).catch((e) => { if (/not.?found/i.test(String(e && (e.name || e.message)))) return null; throw e; });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  const chunks = []; for await (const c of r.stream) chunks.push(Buffer.from(c)); return Buffer.concat(chunks);
}
export async function putBuf(p, buf, type = 'application/octet-stream') {
  safe(p);
  if (DIR) { const f = path.join(DIR, p); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f + '.tmp', buf); await fs.rename(f + '.tmp', f); return; }
  const { put } = await B();
  await put(p, buf, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: type });
}
export async function getJSON(p) { const b = await getBuf(p, true); if (!b) return null; try { return JSON.parse(b.toString('utf8')); } catch { return null; } }
export const putJSON = (p, obj) => putBuf(p, Buffer.from(JSON.stringify(obj)), 'application/json');
export function configured() { return !!(DIR || process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN || process.env.BLOB_STORE_ID); }
