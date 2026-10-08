// GET api/car/info : is car building switched on here? (the Garage asks before showing Build my car)
import { send, preflight } from '../_lib/util.js';
import { configured } from '../_lib/store.js';
import { providerReady } from '../_lib/cars.js';
export default function handler(req, res) {
  if (preflight(req, res)) return;
  send(res, 200, { ok: true, build: providerReady() && configured(), store: configured(), edit: true, ai: !!process.env.ANTHROPIC_API_KEY, invite: true });
}
