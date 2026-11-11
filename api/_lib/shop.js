// The shop (v21.9, Morgan: "a monetization framework ... you can purchase things like being able to make that 3d version of your
// own or a different car"; pay per car). A car build is sold as a BUILD CODE: a code like CAR-7KQ2M9XT4B that works in the
// Build my car box exactly as an invite code does, good for M67_CAR_BUILDS builds (2 unless set: the car, and one do-over
// with better photos; a build that fails is given back as before). No accounts: the code is the purchase, shown to the
// buyer and kept on their device. On the website it is paid for with Stripe Checkout (Stripe's own page takes the card;
// this site never sees it). In the phone apps the stores require their own in-app purchase: see iap() in api/shop.js.
//
// Nothing here is on until these are set in Vercel (never in the code):
//   STRIPE_SECRET_KEY   the Stripe secret key (sk_live_... ; sk_test_... to try it with Stripe's test cards)
//   STRIPE_PRICE_CAR    the Price ID of the "car build" product made in Stripe (price_...)
//   M67_CAR_PRICE_LABEL what the button says it costs, e.g. "$2.99" (shown only; Stripe charges the Price)
//   M67_CAR_BUILDS      builds per purchase (default 2)
//   M67_ADS_WEB         "adsense" to show ads on the website (with M67_ADS_CLIENT = ca-pub-...); M67_ADS_EVERY_MIN (default 4)
// For trying it on a computer without Stripe: M67_SHOP_MOCK=1 (with M67_STORE_DIR): "payments" always succeed.
import crypto from 'node:crypto';
import { getJSON, putJSON } from './store.js';
import { sha, codeHash } from './util.js';

export const MOCK = () => !!process.env.M67_SHOP_MOCK && !!process.env.M67_STORE_DIR; // (never on the real site: it has no store folder)
export const stripeOn = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_CAR);
export const carOn = () => stripeOn() || MOCK();
export const buildsPer = () => Math.min(20, Math.max(1, +(process.env.M67_CAR_BUILDS || 2) || 2));

// Stripe's API, called directly (no library): form-encoded, the secret key as the bearer
export async function stripe(path, form) {
  const r = await fetch('https://api.stripe.com/v1/' + path, { method: form ? 'POST' : 'GET', headers: Object.assign({ Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY }, form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), body: form ? new URLSearchParams(form).toString() : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error('Stripe: ' + ((j && j.error && j.error.message) || r.status));
  return j;
}

// a build code for a purchase, made once: asking again for the same purchase (`ref`: where it was paid and its ID there) gives
// the same code, so a page reloaded after paying, or a claim sent twice, never makes two
const CODE_AB = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // (no 0/O, 1/I/L)
export async function mintCode(src, ref) {
  const rp = `shop/ref/${sha(src + ':' + ref).slice(0, 32)}.json`, had = await getJSON(rp);
  if (had && had.code) return { code: had.code, builds: had.builds, again: true };
  const b = crypto.randomBytes(10); let code = 'CAR-'; for (const x of b) code += CODE_AB[x % CODE_AB.length];
  const builds = buildsPer(), at = Date.now();
  await putJSON(`shop/codes/${codeHash(code)}.json`, { cap: builds, src, at });
  await putJSON(rp, { code, builds, at });
  return { code, builds, again: false };
}
// how many builds a bought code is good for (undefined: not a bought code); by the code or by its hash
export async function boughtCap(code, hash) {
  const h = hash || (/^CAR-[A-Z2-9]{10}$/.test(String(code || '')) ? codeHash(code) : null); if (!h || !/^[0-9a-f]{24}$/.test(h)) return undefined;
  const rec = await getJSON(`shop/codes/${h}.json`); return rec && rec.cap > 0 && !rec.off ? rec.cap : undefined;
}
