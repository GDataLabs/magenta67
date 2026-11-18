// Build my car's badge cleanup (v23.2). Morgan: "I'd like to have the real cleanup step" (so no car built from players'
// photos carries a real maker's badge, logo, name or plate, on his site or on CrazyGames).
//
// Before the photos go to the 3D service, each one is edited by FLUX.1 Kontext [pro] on fal.ai: every badge, emblem, logo,
// brand or model name, piece of lettering, number and licence-plate character on the car is taken off, and nothing else is
// changed (same car, angle, colour, light and background, so the views still match each other for the 3D model). Then
// Claude (the server's ANTHROPIC_API_KEY, already used by Edit my car) looks at each cleaned photo; anything still readable
// gets one more pass, aimed at what was found; still there after that, the build stops with a plain message and the build
// is refunded (start.js / edit.js). The cleaned photo replaces the original in storage, so the 3D service, and a later
// "Build it again" with the same photos, only ever see the clean one (a photo already cleaned isn't cleaned again).
//
// Keys (Vercel: Settings -> Environment Variables; never in the code):
//   FAL_KEY            : fal.ai, about $0.04 a photo (the same key fal's copy of the 3D model uses)
//   ANTHROPIC_API_KEY  : the check (optional: without it the edit still runs, unchecked)
//   M67_CLEAN=off      : turns the cleanup off on purpose (testing only)
// With no FAL_KEY the cleanup can't run, so car building switches itself off (cars.js providerReady) instead of building
// cars that might keep a badge.
import { getBuf, putBuf } from './store.js';
import { which } from './provider.js';

const KONTEXT = 'https://fal.run/fal-ai/flux-pro/kontext';
const ASK = 'Remove every brand logo, badge, emblem, crest, manufacturer name, model name, script lettering, number, decal with text and licence plate character from the car, and leave a plain blank plate. Fill each place with the car\'s own paint, chrome, grille or trim so it looks like it was never there. Change nothing else: keep the same car, shape, angle, framing, paint colour, wheels, lights, reflections, lighting and background exactly as they are.';

export const cleanOff = () => process.env.M67_CLEAN === 'off' || which() === 'mock';
export const cleanReady = () => cleanOff() || !!process.env.FAL_KEY;

async function timed(url, opt, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, Object.assign({ signal: ac.signal }, opt)); } finally { clearTimeout(t); }
}

// one Kontext pass over a JPEG; returns a JPEG (no bigger than 1024 px, as the photos are kept)
async function kontext(buf, extra, sharp) {
  const r = await timed(KONTEXT, {
    method: 'POST', headers: { Authorization: 'Key ' + process.env.FAL_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: extra ? ASK + ' Make sure these are gone too: ' + extra.slice(0, 300) + '.' : ASK, image_url: 'data:image/jpeg;base64,' + buf.toString('base64'), sync_mode: true, output_format: 'jpeg', guidance_scale: 3.5, safety_tolerance: '2', num_images: 1 }),
  }, 28000);
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { }
  if (!r.ok) throw new Error(`cleanup service ${r.status}: ${(j && (j.detail || j.message || j.error)) ? JSON.stringify(j.detail || j.message || j.error).slice(0, 160) : txt.slice(0, 160)}`);
  const u = j && j.images && j.images[0] && j.images[0].url; if (!u) throw new Error('cleanup service: no picture back');
  let out;
  if (u.startsWith('data:')) out = Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
  else { const g = await timed(u, {}, 15000); if (!g.ok) throw new Error('cleanup service: picture ' + g.status); out = Buffer.from(await g.arrayBuffer()); }
  return sharp(out).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
}

// Claude looks for anything left: { left: bool, what: string } (null if it can't check)
async function check(buf) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const tool = { name: 'report', description: 'Report what is left on the car.', input_schema: { type: 'object', properties: {
    left: { type: 'boolean', description: 'true if any brand logo, badge, emblem, crest, maker or model name, readable lettering, number or licence plate character can still be made out on the car itself (not the background).' },
    what: { type: 'string', description: 'Each one left and where it is, briefly, e.g. "round badge in the centre of the grille, script on the boot lid". Empty if none.' } }, required: ['left', 'what'] } };
  try {
    const r = await timed('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.M67_CHECK_MODEL || 'claude-haiku-4-5', max_tokens: 300, tools: [tool], tool_choice: { type: 'tool', name: 'report' },
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }, { type: 'text', text: 'This photo of a car should carry no brand marks at all. Look closely at the grille, bonnet, boot, wings, wheels, hubcaps, side panels, windows and number plates. Is any logo, badge, emblem, maker or model name, lettering, number or plate character still visible on the car? Ignore the background and anything not on the car.' }] }] }),
    }, 15000);
    if (!r.ok) return null;
    const j = await r.json(), u = (j.content || []).find(c => c.type === 'tool_use'); if (!u || !u.input) return null;
    return { left: !!u.input.left, what: String(u.input.what || '').slice(0, 300) };
  } catch { return null; }
}

// Clean the car's photos that haven't been cleaned yet (m.views; m.clean marks the clean ones). Throws an Error whose
// .player is the message for the player when a badge can't be taken off.
export async function cleanBadges(m, sharp) {
  if (cleanOff()) return { skipped: true };
  if (!process.env.FAL_KEY) { const e = new Error('no cleanup service'); e.player = "Car building isn't switched on yet."; throw e; }
  m.clean = m.clean || {};
  const todo = (m.views || []).filter(v => !m.clean[v]), notes = [];
  await Promise.all(todo.map(async (v) => {
    const path = `cars/${m.id}/photo-${v}.jpg`, orig = await getBuf(path); if (!orig) throw new Error('photo missing: ' + v);
    let img = await kontext(orig, '', sharp), c = await check(img), passes = 1;
    if (c && c.left) { img = await kontext(img, c.what, sharp); passes = 2; c = await check(img); }
    if (c && c.left) { const e = new Error('badge left: ' + v + ': ' + c.what); e.player = `A badge or lettering on the ${v} photo couldn't be taken off (${c.what || 'on the car'}). Try another photo of that side, from a little further back.`; throw e; }
    await putBuf(path, img, 'image/jpeg'); m.clean[v] = Date.now(); notes.push(`${v}: ${passes} pass${passes > 1 ? 'es' : ''}${c ? '' : ', not checked'}`);
  }));
  m.cleanNotes = notes.join('; ');
  return { cleaned: todo.length, notes };
}
