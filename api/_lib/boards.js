// Leaderboards (v20.6, Morgan: "the leaderboard and friends ghosts"): every sprint's best times from everyone who plays on the
// site, each with the run itself (the ghost) so friends can race it. No accounts: each player's game makes its own id (10
// letters, also their friend code) and a secret key; the key's hash is kept with the id so nobody else can post as them or
// rename them. Stored in the site's private Blob store (or M67_STORE_DIR when testing):
//   lb/players/<id>.json        { id, kh: sha256 of the key, name, at }
//   lb/boards/<race>.json       { race, entries: [{ p, n, t, car, at, b }] }  (fastest first; each player's best only; 300 kept)
//   lb/ghosts/<race>/<id>.json  { race, p, n, t, car, at, d: [[t, x, y, z, heading, pitch, roll(, qx, qy, qz, qw)], ...] }
// A run is checked before it counts: a real time (8 s to an hour), a ghost that lasts as long as the time, moves no faster
// than a car can (portal jumps aside), and samples of the game's own shape.
import { getJSON, putJSON } from './store.js';
import { sha, cleanText, safeEq } from './util.js';

export const PID_RE = /^[a-z2-7]{10}$/;
export const KEY_RE = /^[0-9a-f]{32}$/;
export const RACE_RE = /^[a-z0-9_]{2,24}$/;
export const KEEP = 300;
export const cleanName = (s) => cleanText(s, 16).replace(/["&]/g, '') || 'Driver';
export const cleanCar = (s) => cleanText(s, 32).replace(/["&]/g, '');
const boardPath = (race) => 'lb/boards/' + race + '.json';
const ghostPath = (race, p) => 'lb/ghosts/' + race + '/' + p + '.json';
const playerPath = (p) => 'lb/players/' + p + '.json';
const kh = (k) => sha('m67-board:' + k).slice(0, 40);

export async function loadBoard(race) { const b = await getJSON(boardPath(race)); return b && Array.isArray(b.entries) ? b : { race, entries: [] }; }
export const saveBoard = (b) => putJSON(boardPath(b.race), b);
export const loadGhost = (race, p) => getJSON(ghostPath(race, p));
export const saveGhost = (g) => putJSON(ghostPath(g.race, g.p), g);
export const loadPlayer = (p) => getJSON(playerPath(p));

// the player's record: made on their first post; after that the key has to match
export async function checkPlayer(p, k, name) {
  if (!PID_RE.test(p || '') || !KEY_RE.test(k || '')) return { ok: false, status: 400, error: 'bad player' };
  const rec = await loadPlayer(p);
  if (!rec) { const r = { id: p, kh: kh(k), name: cleanName(name), at: Date.now() }; await putJSON(playerPath(p), r); return { ok: true, rec: r, fresh: true }; }
  if (!safeEq(rec.kh, kh(k))) return { ok: false, status: 403, error: 'That player id belongs to someone else.' };
  return { ok: true, rec };
}
export async function renamePlayer(rec, name) { rec.name = cleanName(name); await putJSON(playerPath(rec.id), rec); return rec; }

// a run, as the game records it (73_ghost.js): checked number by number
export function checkRun(t, d) {
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 8 || t > 3600) return 'bad time';
  if (!Array.isArray(d) || d.length < 5 || d.length > 40000) return 'bad ghost';
  let prev = -1, dist = 0, last = null, maxGap = 0;
  for (const r of d) {
    if (!Array.isArray(r) || (r.length !== 7 && r.length !== 11)) return 'bad ghost sample';
    for (const v of r) if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e5) return 'bad ghost number';
    if (r[0] < prev) return 'ghost out of order'; prev = r[0];
    if (last) { const s = Math.hypot(r[1] - last[1], r[2] - last[2], r[3] - last[3]); if (s < 320) dist += s; maxGap = Math.max(maxGap, r[0] - last[0]); } // (a jump of 320 m or more between two samples is a portal)
    last = r;
  }
  if (d[0][0] > 3) return 'ghost starts late';
  if (Math.abs(d[d.length - 1][0] - (t + 1)) > 1.6 && Math.abs(d[d.length - 1][0] - t) > 1.6) return "ghost doesn't match the time";
  if (maxGap > 30) return 'ghost has a gap';
  if (dist / t > 115) return 'too fast to be true';
  return null;
}
// a player's place on a board: 1 = fastest
export const rankOf = (b, p) => { const i = b.entries.findIndex(e => e.p === p); return i < 0 ? 0 : i + 1; };
export const pub = (e, i, me, friends) => ({ rank: i + 1, p: e.p, name: e.n, t: e.t, car: e.car || '', at: e.at, me: e.p === me || undefined, friend: friends && friends.has(e.p) || undefined });
// a new time onto the board: only if it beats that player's own best there
export function addRun(b, entry) {
  const i = b.entries.findIndex(e => e.p === entry.p);
  if (i >= 0 && b.entries[i].t <= entry.t) return false;
  if (i >= 0) b.entries.splice(i, 1);
  b.entries.push(entry); b.entries.sort((x, y) => x.t - y.t || x.at - y.at);
  if (b.entries.length > KEEP) b.entries.length = KEEP;
  return b.entries.includes(entry);
}
export const friendSet = (s) => new Set(String(s || '').split(',').filter(x => PID_RE.test(x)).slice(0, 60));
