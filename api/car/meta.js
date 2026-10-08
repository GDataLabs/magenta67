// GET api/car/meta?id= : a car's public record (name, owner, versions and their settings). Friends load cars by this.
import { send, fail, preflight, query, ID_RE, guard } from '../_lib/util.js';
import { loadMeta, publicMeta } from '../_lib/cars.js';
async function handler(req, res) {
  if (preflight(req, res)) return;
  const q = query(req); if (!ID_RE.test(q.id || '')) return fail(res, 400, 'bad id');
  const m = await loadMeta(q.id); if (!m) return fail(res, 404, 'No such car');
  send(res, 200, { ok: true, meta: publicMeta(m) });
}
export default guard(handler);
