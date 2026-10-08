// POST api/car/start : { code, name, owner, size, photos: { front, left?, back?, right? } (data: URLs) }
// -> { id, key } : the key (kept on the player's device) is what lets them edit the car later.
import { send, fail, preflight, body, newId, newKey, sha, cleanText } from '../_lib/util.js';
import { configured, putBuf } from '../_lib/store.js';
import { VIEWS, useInvite, refundInvite, cleanPhoto, startJob, providerReady, saveMeta } from '../_lib/cars.js';
import { SIZE_LEN } from '../_lib/settings.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'POST only');
  if (!providerReady() || !configured()) return fail(res, 503, "Car building isn't switched on yet.");
  let b; try { b = await body(req); } catch { return fail(res, 400, 'Those photos are too big together. Try again (they are made smaller first).'); }
  const name = cleanText(b.name, 24), owner = cleanText(b.owner, 16), size = SIZE_LEN[b.size] ? b.size : 'car';
  if (!name) return fail(res, 400, 'Give your car a name.');
  const ph = b.photos || {}, views = VIEWS.filter(v => typeof ph[v] === 'string' && ph[v]);
  if (!views.includes('front')) return fail(res, 400, 'A photo of the front is needed.');
  if (views.length < 2) return fail(res, 400, 'Add at least one more photo (a side or the back).');
  const photos = {};   // (checked and re-saved before an invite build is used)
  try { for (const v of views) photos[v] = await cleanPhoto(ph[v]); } catch (e) { return fail(res, 400, /photo|picture/i.test(String(e.message)) ? e.message : "A photo couldn't be read."); }
  const inv = await useInvite(b.code); if (!inv.ok) return fail(res, 403, inv.error);
  try {
    const id = newId(), key = newKey();
    for (const v of views) await putBuf(`cars/${id}/photo-${v}.jpg`, photos[v], 'image/jpeg');
    const m = { id, name, owner, size, created: Date.now(), keyHash: sha(key), codeHash: inv.hash, views, builds: 1, lastCharge: inv.hash, versions: [], geos: [], cur: 0, state: 'building',
      mockKind: typeof b.mock === 'string' && process.env.M67_MOCK_DIR ? b.mock.replace(/[^a-z]/g, '') : undefined };
    await saveMeta(m);
    const proto = req.headers['x-forwarded-proto'] || 'https', host = req.headers['x-forwarded-host'] || req.headers.host;
    await startJob(m, `${proto}://${host}`);
    send(res, 200, { ok: true, id, key, left: inv.left, state: m.state });
  } catch (e) {
    await refundInvite(inv.hash);
    fail(res, 502, "Couldn't start the 3D step. Please try again in a bit.");
  }
}
