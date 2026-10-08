// POST api/car/edit : the car's owner (who has its key) changes it.
//   { id, key, text }              Edit my car: what to change, in words -> a new version (or advice to build again)
//   { id, key, use: v }            go back (or forward) to version v (Undo, and the history list)
//   { id, key, rename: 'name' }
//   { id, key, rebuild: true, photos?: {...} }   Build it again (new photos optional): uses one build from the invite code
import { send, fail, preflight, body, ID_RE, KEY_RE, cleanText, today } from '../_lib/util.js';
import { getJSON, putJSON, putBuf } from '../_lib/store.js';
import { loadMeta, saveMeta, keyOk, publicMeta, makeGeo, addVersion, useInvite, refundInvite, cleanPhoto, startJob, inviteLeft, VIEWS } from '../_lib/cars.js';
import { clean, rules, ai, sameGeo, defaults } from '../_lib/settings.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return fail(res, 405, 'POST only');
  let b; try { b = await body(req); } catch { return fail(res, 400, 'Too big'); }
  if (!ID_RE.test(b.id || '') || !KEY_RE.test(b.key || '')) return fail(res, 400, 'bad id');
  const m = await loadMeta(b.id); if (!m || !keyOk(m, b.key)) return fail(res, 404, 'No such car');
  const cur = (m.versions || []).find(v => v.v === m.cur);

  if (b.use !== undefined) {
    const v = (m.versions || []).find(x => x.v === +b.use); if (!v) return fail(res, 400, 'No such version');
    m.cur = v.v; await saveMeta(m); return send(res, 200, { ok: true, meta: publicMeta(m) });
  }
  if (b.rename !== undefined) {
    const n = cleanText(b.rename, 24); if (!n) return fail(res, 400, 'Give your car a name.');
    m.name = n; await saveMeta(m); return send(res, 200, { ok: true, meta: publicMeta(m) });
  }
  if (b.rebuild) {
    if (m.state === 'building' || m.state === 'processing') return fail(res, 409, 'It is already being built.');
    const inv = await useInvite(null, m.codeHash); if (!inv.ok) return fail(res, 403, inv.error);
    try {
      const ph = b.photos || {}, views = VIEWS.filter(v => typeof ph[v] === 'string' && ph[v]);
      if (views.length) {
        if (!views.includes('front') && !m.views.includes('front')) return fail(res, 400, 'A photo of the front is needed.');
        for (const v of views) await putBuf(`cars/${m.id}/photo-${v}.jpg`, await cleanPhoto(ph[v]), 'image/jpeg');
        m.views = VIEWS.filter(v => views.includes(v) || m.views.includes(v));
      }
      m.builds = (m.builds || 1) + 1; m.lastCharge = inv.hash;
      const proto = req.headers['x-forwarded-proto'] || 'https', host = req.headers['x-forwarded-host'] || req.headers.host;
      await startJob(m, `${proto}://${host}`);
      return send(res, 200, { ok: true, state: m.state, left: inv.left, meta: publicMeta(m) });
    } catch (e) { await refundInvite(inv.hash); return fail(res, /photo|picture/i.test(String(e.message)) ? 400 : 502, /photo|picture/i.test(String(e.message)) ? e.message : "Couldn't start the 3D step. Please try again in a bit."); }
  }

  // ---- Edit my car (words)
  const text = cleanText(b.text, 400); if (!text) return fail(res, 400, 'Type what you would like changed.');
  if (!cur) return fail(res, 409, "The car isn't ready yet.");
  // limits: 60 edits per car per day, and the whole site's AI use per day
  const cp = `daily/edits-${m.id}-${today()}.json`, dp = `daily/${today()}.json`, cc = (await getJSON(cp)) || { n: 0 }, day = (await getJSON(dp)) || { builds: 0, edits: 0 };
  if (cc.n >= 60) return fail(res, 429, "That's a lot of changes for one day. Try again tomorrow.");
  const useAI = day.edits < +(process.env.M67_EDITS_PER_DAY || 500);
  const r = (useAI && await ai(text, cur.settings, m.name)) || Object.assign(rules(text, cur.settings), { by: 'rules' });
  cc.n++; await putJSON(cp, cc); if (r.by === 'ai') { day.edits++; await putJSON(dp, day); }
  const merged = clean(Object.assign({}, cur.settings, r.patch, { stats: Object.assign({}, cur.settings.stats, r.patch.stats || {}) }), cur.settings, r.raised);
  if (JSON.stringify(merged) === JSON.stringify(cur.settings)) return send(res, 200, { ok: true, changed: false, reply: r.reply, rebuild: !!r.rebuild, meta: publicMeta(m), by: r.by });
  try {
    if (!sameGeo(merged, cur.settings)) { // a new size or facing: the game car is made again from the 3D model (free)
      const raw = (m.geos.find(g => g.g === cur.g) || {}).raw || m.raws;
      await makeGeo(m, raw, merged, text);
    } else addVersion(m, cur.g, merged, text);
  } catch (e) { return fail(res, 500, "Couldn't make that change. Try something else."); }
  await saveMeta(m);
  send(res, 200, { ok: true, changed: true, reply: r.reply, rebuild: !!r.rebuild, version: m.cur, meta: publicMeta(m), by: r.by, left: await inviteLeft(m.codeHash) });
}
