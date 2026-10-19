// Leaderboards and friends' ghosts (v20.6): one function for all of it (the site keeps its count of functions low).
//   GET  api/lb?op=top&race=ID&me=PID&f=PID,PID      one sprint's board: the top 25, you, your friends
//   GET  api/lb?op=top&races=ID,ID,...&me=&f=        every sprint at once: how many on it, the fastest, you, your fastest friends
//   GET  api/lb?op=ghost&race=ID&p=PID               a player's best run of a sprint, to race against
//   GET  api/lb?op=names&ids=PID,PID                 players' names (the friends list)
//   POST api/lb?op=submit {race, t, car, name, p, k, g, b}   a new personal best, with its ghost
//   POST api/lb?op=name {p, k, name, races}          change your name (on the boards you're on too)
// See _lib/boards.js for how players, boards and ghosts are kept and how a run is checked.
import { send, fail, preflight, query, body, guard } from './_lib/util.js';
import { configured } from './_lib/store.js';
import { RACE_RE, PID_RE, checkPlayer, checkRun, loadBoard, saveBoard, saveGhost, loadGhost, loadPlayer, addRun, rankOf, pub, friendSet, cleanName, cleanCar, renamePlayer } from './_lib/boards.js';
async function submit(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'POST only');
  const q = await body(req);
  if (!RACE_RE.test(q.race || '')) return fail(res, 400, 'bad race');
  const t = Math.round(+q.t * 1000) / 1000, bad = checkRun(t, q.g); if (bad) return fail(res, 400, 'That run could not be checked: ' + bad);
  const pl = await checkPlayer(q.p, q.k, q.name); if (!pl.ok) return fail(res, pl.status, pl.error);
  const name = cleanName(q.name); if (!pl.fresh && name !== pl.rec.name) await renamePlayer(pl.rec, name);
  const b = await loadBoard(q.race), now = Date.now(), mine = b.entries.find(e => e.p === q.p);
  if (mine && now - (mine.at || 0) < 4000) return fail(res, 429, 'Too quick: try again in a moment.');
  const entry = { p: q.p, n: name, t, car: cleanCar(q.car), at: now, b: String(q.b || '').replace(/[^0-9a-f]/g, '').slice(0, 12) };
  const better = addRun(b, entry);
  if (better) { await saveGhost({ race: q.race, p: q.p, n: name, t, car: entry.car, at: now, d: q.g }); await saveBoard(b); }
  else if (mine && mine.n !== name) { mine.n = name; await saveBoard(b); }
  const rank = rankOf(b, q.p);
  send(res, 200, { ok: true, race: q.race, better, rank, n: b.entries.length, best: rank ? b.entries[rank - 1].t : null, top: b.entries.slice(0, 3).map((e, i) => pub(e, i, q.p)) });
}
async function top(req, res) {
  const q = query(req), me = PID_RE.test(q.me || '') ? q.me : '', F = friendSet(q.f);
  if (q.races) {
    const ids = [...new Set(String(q.races).split(','))].filter(r => RACE_RE.test(r)).slice(0, 48);
    const out = {};
    await Promise.all(ids.map(async (race) => {
      const b = await loadBoard(race), E = b.entries; if (!E.length) { out[race] = { n: 0 }; return; }
      const mi = me ? E.findIndex(e => e.p === me) : -1, fr = [];
      E.forEach((e, i) => { if (F.has(e.p) && fr.length < 3) fr.push(pub(e, i, me, F)); });
      out[race] = { n: E.length, best: pub(E[0], 0, me, F), me: mi >= 0 ? pub(E[mi], mi, me, F) : null, friends: fr };
    }));
    return send(res, 200, { ok: true, races: out });
  }
  if (!RACE_RE.test(q.race || '')) return fail(res, 400, 'bad race');
  const b = await loadBoard(q.race), E = b.entries, mi = me ? E.findIndex(e => e.p === me) : -1;
  send(res, 200, { ok: true, race: q.race, n: E.length, top: E.slice(0, 25).map((e, i) => pub(e, i, me, F)), me: mi >= 0 ? pub(E[mi], mi, me, F) : null, friends: E.map((e, i) => [e, i]).filter(([e]) => F.has(e.p)).slice(0, 60).map(([e, i]) => pub(e, i, me, F)) });
}
async function ghost(req, res) {
  const q = query(req); if (!RACE_RE.test(q.race || '') || !PID_RE.test(q.p || '')) return fail(res, 400, 'bad request');
  const g = await loadGhost(q.race, q.p); if (!g || !Array.isArray(g.d)) return fail(res, 404, 'No run saved for that player.');
  send(res, 200, { ok: true, race: g.race, p: g.p, name: g.n, t: g.t, car: g.car, at: g.at, d: g.d }, { cache: 'public, max-age=120' });
}
async function player(req, res) {
  if (req.method === 'POST') {
    const q = await body(req), pl = await checkPlayer(q.p, q.k, q.name); if (!pl.ok) return fail(res, pl.status, pl.error);
    const name = cleanName(q.name); if (pl.fresh || name === pl.rec.name) return send(res, 200, { ok: true, name });
    await renamePlayer(pl.rec, name);
    const races = String(q.races || '').split(',').filter(r => RACE_RE.test(r)).slice(0, 48); // (the boards the game knows it's on)
    await Promise.all(races.map(async (race) => { const b = await loadBoard(race), e = b.entries.find(x => x.p === q.p); if (e && e.n !== name) { e.n = name; await saveBoard(b); } }));
    return send(res, 200, { ok: true, name });
  }
  const ids = [...new Set(String(query(req).ids || '').split(','))].filter(x => PID_RE.test(x)).slice(0, 60), out = {};
  await Promise.all(ids.map(async (id) => { const r = await loadPlayer(id); if (r) out[id] = r.name; }));
  send(res, 200, { ok: true, names: out });
}
async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!configured()) return fail(res, 503, "Leaderboards aren't switched on for this site yet.");
  const op = query(req).op;
  if (op === 'submit') return submit(req, res);
  if (op === 'top') return top(req, res);
  if (op === 'ghost') return ghost(req, res);
  if (op === 'names' || op === 'name') return player(req, res);
  fail(res, 400, 'bad op');
}
export default guard(handler);
