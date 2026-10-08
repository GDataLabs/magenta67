// Edit my car (v16.0): a player types what they'd like changed ("paint it dark blue with black wheels, and lower it")
// and it becomes changes to the car's settings. Settings change instantly and cost nothing; a new shape needs the
// 3D step again ("Build it again", which uses one build from the invite code).
// With ANTHROPIC_API_KEY set in Vercel, Claude reads the request; without it (or if that fails) simple word rules do.
export const WHEELS = ['steel', 'rally', 'wire', 'fivespoke', 'beadlock', 'knock', 'shelby'];
export const FINISH = ['gloss', 'satin', 'matte', 'metallic'];
export const STAT_KEYS = ['power', 'grip', 'turning', 'offroad'], STAT_BUDGET = 13;
export const SIZE_LEN = { sports: 4.45, car: 4.75, suv: 4.9, truck: 5.9 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const HEX = /^#[0-9a-f]{6}$/;

export function defaults(size) {
  const truck = size === 'truck' || size === 'suv';
  return { paint: null, finish: null, wheels: truck ? 'beadlock' : size === 'sports' ? 'fivespoke' : 'rally', rim: null, tyre: 1, ride: 0, length: SIZE_LEN[size] || SIZE_LEN.car, flip: false,
    stats: truck ? { power: 4, grip: 2, turning: 2, offroad: 4 } : size === 'sports' ? { power: 4, grip: 4, turning: 3, offroad: 1 } : { power: 3, grip: 3, turning: 3, offroad: 2 } };
}
// every value forced into range; the four stats share a budget of 13 points (each 1..5): raising one takes from the others
export function clean(s, prev, raised) {
  const d = prev || defaults('car'), o = {};
  const hex = (v, f) => (v === null ? null : typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : f);
  o.paint = hex(s.paint, d.paint); o.rim = hex(s.rim, d.rim);
  o.finish = s.finish === null || FINISH.includes(s.finish) ? s.finish : d.finish;
  o.wheels = WHEELS.includes(s.wheels) ? s.wheels : d.wheels;
  o.tyre = Math.round(clamp(+s.tyre || d.tyre || 1, 0.85, 1.3) * 100) / 100;
  o.ride = Math.round(clamp(Number.isFinite(+s.ride) ? +s.ride : d.ride || 0, -0.08, 0.25) * 1000) / 1000;
  o.length = Math.round(clamp(+s.length || d.length || 4.75, 3.6, 6.4) * 100) / 100;
  o.flip = typeof s.flip === 'boolean' ? s.flip : !!d.flip;
  const st = Object.assign({}, d.stats, s.stats || {});
  for (const k of STAT_KEYS) st[k] = Math.round(clamp(+st[k] || 1, 1, 5));
  let over = STAT_KEYS.reduce((t, k) => t + st[k], 0) - STAT_BUDGET;
  while (over > 0) { // take from the biggest of the others
    const k = STAT_KEYS.filter(k => !(raised || []).includes(k) && st[k] > 1).sort((a, b) => st[b] - st[a])[0] || STAT_KEYS.filter(k => st[k] > 1).sort((a, b) => st[b] - st[a])[0];
    if (!k) break; st[k]--; over--;
  }
  o.stats = st;
  return o;
}
export const sameGeo = (a, b) => Math.abs(a.length - b.length) < 0.005 && !!a.flip === !!b.flip;

// ---- the word rules (no AI needed)
const COLORS = {
  'dark red': '#6d0f16', maroon: '#5c0d18', burgundy: '#5c0d18', 'cherry red': '#a5101c', red: '#c41e1e', orange: '#e2621b', yellow: '#f2c51a', gold: '#c9a23a',
  'dark green': '#0f3d26', 'forest green': '#14402a', 'lime green': '#8fd12a', lime: '#8fd12a', 'mint green': '#8fd8b0', green: '#1f8a3b', teal: '#11867f', turquoise: '#2bb7b0',
  'navy blue': '#142a5c', navy: '#142a5c', 'dark blue': '#16306e', 'light blue': '#6fb7ea', 'sky blue': '#6fb7ea', 'baby blue': '#9cc8ec', blue: '#1f56c4',
  purple: '#6b2fa8', violet: '#7b3fc0', 'hot pink': '#e8327f', pink: '#e85a9c', magenta: '#c2185b', white: '#f2f2ee', 'pearl white': '#f4f1ea', silver: '#b8bcc2',
  'dark grey': '#3c3f44', 'dark gray': '#3c3f44', grey: '#6e7177', gray: '#6e7177', black: '#121314', brown: '#5b3a22', bronze: '#8c5a2b', copper: '#b2582d', cream: '#e6d8b5', beige: '#d9c7a0', tan: '#c8a878',
};
const colorIn = (t) => { for (const [n, h] of Object.entries(COLORS)) if (new RegExp('\\b' + n + '\\b').test(t)) return [n, h]; const m = /#[0-9a-f]{6}\b/.exec(t); return m ? [m[0], m[0]] : null; };
export function rules(text, cur) {
  const t = ' ' + String(text).toLowerCase().replace(/[^a-z0-9#\s-]/g, ' ') + ' ', patch = {}, said = [], raised = [];
  // one clause at a time ("paint it blue and make the rims black")
  for (const c of t.split(/\b(?:and|but|then|also|with|plus)\b|,|;/)) {
    const col = colorIn(c), wheely = /\b(rim|rims|wheel|wheels)\b/.test(c);
    if (col && wheely) { patch.rim = col[1]; said.push(`${col[0]} wheels`); }
    else if (/\bchrome\b/.test(c) && wheely) { patch.rim = null; said.push('chrome wheels'); }
    else if (col) { patch.paint = col[1]; said.push(`${col[0]} paint`); }
    if (/\b(original|stock|real) (colou?r|paint)\b|\bput the (colou?r|paint) back\b/.test(c)) { patch.paint = null; said.push('its own paint again'); }
    if (/\bmatte?\b|\bflat\b/.test(c) && !wheely) { patch.finish = 'matte'; said.push('a matte finish'); }
    else if (/\bmetallic\b|\bmetal flake\b/.test(c)) { patch.finish = 'metallic'; said.push('a metallic finish'); }
    else if (/\bsatin\b/.test(c)) { patch.finish = 'satin'; said.push('a satin finish'); }
    else if (/\b(gloss|glossy|shiny|shinier)\b/.test(c)) { patch.finish = 'gloss'; said.push('a gloss finish'); }
    const styles = [['beadlock', /\b(beadlock|off ?-?road (rims|wheels))\b/], ['fivespoke', /\b(five|5) ?-?spoke\b/], ['steel', /\bsteel(ies)?\b/], ['wire', /\bwire\b/], ['rally', /\brally\b/], ['knock', /\b(knock ?-?off|spinner)s?\b/]];
    for (const [w, re] of styles) if (re.test(c)) { patch.wheels = w; said.push(`${w === 'fivespoke' ? 'five-spoke' : w} wheels`); break; }
    if (/\b(bigger|larger|huge|big)\b.*\b(wheels|tyres|tires|rims)\b/.test(c)) { patch.tyre = (cur.tyre || 1) + 0.1; said.push('bigger wheels'); }
    if (/\b(smaller|little)\b.*\b(wheels|tyres|tires|rims)\b/.test(c)) { patch.tyre = (cur.tyre || 1) - 0.1; said.push('smaller wheels'); }
    if (/\b(lower|slam|slammed|drop)\b/.test(c)) { patch.ride = (cur.ride || 0) - 0.04; said.push('lower'); }
    if (/\b(raise|lift|lifted|higher|taller)\b/.test(c) && !/\bwheel/.test(c)) { patch.ride = (cur.ride || 0) + 0.06; said.push('raised'); }
    if (/\b(longer|bigger car|make it bigger|too small)\b/.test(c)) { patch.length = (cur.length || 4.75) * 1.06; said.push('bigger'); }
    if (/\b(shorter|smaller car|make it smaller|too big)\b/.test(c)) { patch.length = (cur.length || 4.75) / 1.06; said.push('smaller'); }
    if (/\b(backwards|back to front|wrong way)\b/.test(c)) { patch.flip = !cur.flip; said.push('turned around'); }
    const bump = (k, re, word) => { if (re.test(c)) { patch.stats = Object.assign(patch.stats || {}, { [k]: (cur.stats[k] || 3) + 1 }); raised.push(k); said.push(word); } };
    bump('power', /\b(faster|quicker|more power|more speed|speed it up)\b/, 'more power');
    bump('grip', /\b(more grip|grippier|stick)\b/, 'more grip');
    bump('turning', /\b(turn(s|ing)? better|sharper|handling|corner)/, 'sharper turning');
    if (!/\b(wheels|rims|tyres|tires)\b/.test(c)) bump('offroad', /\b(off ?-?road|dirt|mud|sand)\b/, 'better off-road');
  }
  const shape = /\b(spoiler|wing|bumper|hood|bonnet|roof|window|door|grille|scoop|stripe|decal|sticker|logo|exhaust|lights?|mirror)s?\b/.test(t) && !said.length;
  return { patch, raised, reply: said.length ? 'Done: ' + [...new Set(said)].join(', ') + '.' : shape ? "That changes the car's shape or details, which needs it built again from your photos (Build it again)." : "I couldn't tell what to change. Try things like: paint it dark blue, black wheels, lower it, more grip.", rebuild: shape };
}

// ---- Claude reads the request
export async function ai(text, cur, carName) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const tool = {
    name: 'change_car', description: 'Change the car the player built, within the game\'s settings.',
    input_schema: { type: 'object', properties: {
      reply: { type: 'string', description: 'One short friendly sentence to the player saying what you changed (or why not). No more than 25 words.' },
      paint: { type: ['string', 'null'], description: 'Body colour as #rrggbb, or null for the colours of the original photos. Omit to leave it.' },
      finish: { type: ['string', 'null'], enum: [...FINISH, null] },
      wheels: { type: 'string', enum: WHEELS, description: 'steel=plain steel, rally=slotted rally, wire=laced wire, fivespoke=polished five-spoke, beadlock=off-road, knock=knock-off spinner, shelby=classic Shelby' },
      rim: { type: ['string', 'null'], description: 'Wheel colour as #rrggbb, or null for chrome.' },
      tyre: { type: 'number', description: 'Wheel size multiplier 0.85..1.3 (1 = as built).' },
      ride: { type: 'number', description: 'Ride height change in metres, -0.08..0.25 (0 = as built).' },
      length: { type: 'number', description: 'Overall length in metres 3.6..6.4 (for bigger / smaller).' },
      flip: { type: 'boolean', description: 'true if the car is facing backwards.' },
      stats: { type: 'object', properties: Object.fromEntries(STAT_KEYS.map(k => [k, { type: 'integer', minimum: 1, maximum: 5 }])), description: `Power, grip, turning, offroad: 1..5 each, at most ${STAT_BUDGET} points in total.` },
      needs_rebuild: { type: 'boolean', description: 'true if the request changes the shape or adds parts (spoiler, bumper, roof, stripes, logos...) which settings cannot do.' },
    }, required: ['reply'] },
  };
  const system = `You help players of Magenta '67, a family-friendly racing game, adjust a car they built from their own photos ("${carName}"). ` +
    `You can only change these settings: ${JSON.stringify(cur)}. Only include the fields that should change. Shapes, parts, stickers, logos and text on the car can't be changed with settings: set needs_rebuild. ` +
    'Never add brand logos or badges. Keep the reply short, warm and plain.';
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ac.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.M67_EDIT_MODEL || 'claude-haiku-4-5', max_tokens: 500, system, tools: [tool], tool_choice: { type: 'tool', name: 'change_car' }, messages: [{ role: 'user', content: String(text).slice(0, 400) }] }),
    });
    if (!r.ok) return null;
    const j = await r.json(), u = (j.content || []).find(c => c.type === 'tool_use'); if (!u || !u.input) return null;
    const inp = u.input, patch = {}, raised = [];
    for (const k of ['paint', 'finish', 'wheels', 'rim', 'tyre', 'ride', 'length', 'flip']) if (k in inp) patch[k] = inp[k];
    if (inp.stats && typeof inp.stats === 'object') { patch.stats = {}; for (const k of STAT_KEYS) if (k in inp.stats) { patch.stats[k] = inp.stats[k]; if (inp.stats[k] > (cur.stats[k] || 0)) raised.push(k); } }
    return { patch, raised, reply: String(inp.reply || 'Done.').slice(0, 220), rebuild: !!inp.needs_rebuild, by: 'ai' };
  } catch { return null; } finally { clearTimeout(tm); }
}
