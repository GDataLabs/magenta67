// GET api/car/info : is car building switched on here? (the Garage asks before showing Build my car)
// Also says whether the image library and the car bake load on this server (no keys or values, just ok / error).
import { send, preflight, guard } from '../_lib/util.js';
import { configured } from '../_lib/store.js';
import { providerReady, engineCheck } from '../_lib/cars.js';
async function handler(req, res) {
  if (preflight(req, res)) return;
  const engine = await engineCheck(), ok = engine.images.startsWith('ok') && engine.bake === 'ok';
  send(res, 200, { ok: true, build: providerReady() && configured() && ok, store: configured(), service: providerReady(), engine, edit: true, ai: !!process.env.ANTHROPIC_API_KEY, invite: true });
}
export default guard(handler);
