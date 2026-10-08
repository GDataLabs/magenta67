// GET api/car/geo?id=&g= : one finished game car (shape + textures, about 1.3 MB). Never changes once made, so it's
// cached for good (on the device and by the CDN).
import { send, fail, preflight, query, ID_RE, guard } from '../_lib/util.js';
import { getBuf } from '../_lib/store.js';
async function handler(req, res) {
  if (preflight(req, res)) return;
  const q = query(req), g = +q.g; if (!ID_RE.test(q.id || '') || !(Number.isInteger(g) && g > 0 && g < 1000)) return fail(res, 400, 'bad id');
  const b = await getBuf(`cars/${q.id}/geo-${g}.json`, false); if (!b) return fail(res, 404, 'No such car');
  send(res, 200, b.toString('utf8'), { cache: 'public, max-age=31536000, s-maxage=31536000, immutable' });
}
export default guard(handler);
