// GET api/car/photo?id=&view=&t= : a car's photo, for the 3D service only, for the few minutes it's building
// (t is a one-off token made when the job starts). Nobody else can see players' photos.
import { fail, preflight, query, ID_RE, safeEq } from '../_lib/util.js';
import { getBuf } from '../_lib/store.js';
import { loadMeta, VIEWS } from '../_lib/cars.js';
export default async function handler(req, res) {
  if (preflight(req, res)) return;
  const q = query(req); if (!ID_RE.test(q.id || '') || !VIEWS.includes(q.view)) return fail(res, 404, 'not found');
  const m = await loadMeta(q.id);
  if (!m || !m.photoToken || !q.t || !safeEq(q.t, m.photoToken) || Date.now() > (m.photoUntil || 0)) return fail(res, 404, 'not found');
  const b = await getBuf(`cars/${q.id}/photo-${q.view}.jpg`); if (!b) return fail(res, 404, 'not found');
  res.statusCode = 200; res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(b);
}
