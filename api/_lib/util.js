// Shared helpers for the Build my car functions (v16.0).
import crypto from 'node:crypto';

// JSON replies: never cached by the CDN, never sniffed as anything else; readable from the offline copy of the game too
// (no cookies are used, so allowing any origin exposes nothing: every write needs the car's key or an invite code)
export function send(res, status, obj, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', extra.cache || 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}
export function preflight(req, res) { if (req.method === 'OPTIONS') { send(res, 204, ''); return true; } return false; }
export const fail = (res, status, msg) => send(res, status, { ok: false, error: msg });

export async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 4.5e6) throw new Error('too big'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export function query(req) { if (req.query) return req.query; return Object.fromEntries(new URL(req.url, 'http://x').searchParams); }

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function newId() { const b = crypto.randomBytes(10); let bits = 0, v = 0, s = ''; for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { s += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } return s; }
export const newKey = () => crypto.randomBytes(16).toString('hex');
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const ID_RE = /^[a-z2-7]{16}$/;
export const KEY_RE = /^[0-9a-f]{32}$/;
export const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
export const cleanText = (s, n) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
export function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

// invite codes, from the M67_INVITES environment variable (set in Vercel, never in the code): "TYFAMILY=6, DEVS=4"
// = code TYFAMILY may build 6 cars (each "build again" counts as one)
export function invites() {
  const out = new Map();
  for (const part of String(process.env.M67_INVITES || '').split(/[,;\s]+/)) {
    const m = /^([A-Za-z0-9-]{4,24})=(\d{1,4})$/.exec(part.trim()); if (m) out.set(m[1].toUpperCase(), +m[2]);
  }
  return out;
}
export const codeHash = (code) => sha('m67-invite:' + String(code).toUpperCase()).slice(0, 24);
