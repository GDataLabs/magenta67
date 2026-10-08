// GET api/car/status?id=&key= : how the build is going (and moves it along: fetches and bakes the model when ready)
import { send, fail, preflight, query, ID_RE } from '../_lib/util.js';
import { loadMeta, keyOk, advance, publicMeta, inviteLeft } from '../_lib/cars.js';
export default async function handler(req, res) {
  if (preflight(req, res)) return;
  const q = query(req); if (!ID_RE.test(q.id || '')) return fail(res, 400, 'bad id');
  let m = await loadMeta(q.id); if (!m || !keyOk(m, q.key)) return fail(res, 404, 'No such car');
  m = await advance(m);
  send(res, 200, { ok: true, state: m.state, progress: Math.round((m.progress || 0) * 100) / 100, msg: m.msg || '', meta: publicMeta(m), left: await inviteLeft(m.codeHash) });
}
