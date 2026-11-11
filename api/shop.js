// api/shop : the shop's one function (see _lib/shop.js for what it sells and the settings that switch it on).
//   GET  api/shop?do=config                 -> { car: { on, price, builds }, ads: { web, client, every } }
//   POST api/shop?do=checkout               -> { url } : Stripe's payment page for one car build; it comes back to the game with ?paid=<session>
//   POST api/shop?do=claim   { session }    -> { code, builds } : the build code, once Stripe says that session is paid
//   POST api/shop?do=iap     { store, ... } -> the phone apps' in-app purchases (not switched on yet)
import { send, fail, preflight, body, query, guard } from './_lib/util.js';
import { configured } from './_lib/store.js';
import { MOCK, stripeOn, carOn, buildsPer, stripe, mintCode } from './_lib/shop.js';

const SESSION = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
async function handler(req, res) {
  if (preflight(req, res)) return;
  const what = String(query(req).do || '');
  if (what === 'config') {
    const ads = String(process.env.M67_ADS_WEB || '').toLowerCase(), client = String(process.env.M67_ADS_CLIENT || '');
    return send(res, 200, { ok: true, car: { on: carOn() && configured(), price: String(process.env.M67_CAR_PRICE_LABEL || '').slice(0, 16), builds: buildsPer() },
      ads: { web: ads === 'adsense' && /^ca-pub-\d{10,20}$/.test(client) ? 'adsense' : '', client: /^ca-pub-\d{10,20}$/.test(client) ? client : '', every: Math.min(60, Math.max(2, +(process.env.M67_ADS_EVERY_MIN || 4) || 4)) } });
  }
  if (req.method !== 'POST') return fail(res, 405, 'POST only');
  if (!carOn() || !configured()) return fail(res, 503, "Buying a car build isn't switched on yet.");
  // the game's own address, from the request (the page that is paid from is the page the buyer comes back to; nothing the player sends is used)
  const proto = req.headers['x-forwarded-proto'] || 'https', host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return fail(res, 400, 'Bad address.');
  const home = `${proto}://${host}/`;
  if (what === 'checkout') {
    if (MOCK()) return send(res, 200, { ok: true, url: home + '?paid=mock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) });
    const s = await stripe('checkout/sessions', { mode: 'payment', 'line_items[0][price]': process.env.STRIPE_PRICE_CAR, 'line_items[0][quantity]': '1',
      success_url: home + '?paid={CHECKOUT_SESSION_ID}', cancel_url: home + '?paid=cancel', 'metadata[item]': 'car-build' });
    if (!s.url) throw new Error('Stripe gave no payment page');
    return send(res, 200, { ok: true, url: s.url });
  }
  if (what === 'claim') {
    let b; try { b = await body(req); } catch { return fail(res, 400, 'Bad request.'); }
    const id = String(b.session || '');
    if (MOCK() && /^mock_[a-z0-9]{6,40}$/.test(id)) { const c = await mintCode('mock', id); return send(res, 200, { ok: true, code: c.code, builds: c.builds }); }
    if (!stripeOn() || !SESSION.test(id)) return fail(res, 400, "That payment wasn't found.");
    const s = await stripe('checkout/sessions/' + encodeURIComponent(id));
    if (s.payment_status !== 'paid' || !(s.metadata && s.metadata.item === 'car-build')) return fail(res, 402, "That payment hasn't gone through (yet). If you were charged, wait a minute and open the game's link from your receipt again.");
    const c = await mintCode('stripe', s.id);
    return send(res, 200, { ok: true, code: c.code, builds: c.builds });
  }
  if (what === 'iap') return fail(res, 501, "Buying in the app isn't switched on yet."); // (the apps: check the store's receipt with Apple / Google here, then mintCode('apple' | 'google', the transaction's ID))
  return fail(res, 404, 'Not found.');
}
export default guard(handler);
