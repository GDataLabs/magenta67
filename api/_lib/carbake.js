// Build my car (v16.0): turn the 3D service's model of a player's car into the game's car data, with no hand fixes.
// A generic version of tools/bake_rival.py (the rivals' hand-tuned bake):
//  - the game's car frame: +z forward, ground at y = 0, origin midway between the axles; scaled to the size the player
//    picked (sports car / car / SUV / pickup), and narrowed if the model came out too wide (the 3D models run chunky)
//  - the four wheels: the dark tyre ring in each corner (a circle fit); the generated wheels are cut out of the body and
//    the game's own spinning wheels go in their place. If a ring can't be found, a sensible spot is used instead.
//  - head and tail lamps (bright faces at the nose, red at the tail), the tailpipes, the paint colour (the biggest
//    colour on the doors) and a paint mask over the texture (for the clear coat and for repainting in Edit my car)
//  - the mesh packed like the rivals' (meshopt, 16-byte vertices) with a quarter-size far / shadow LOD; the textures
//    as WebP data URLs (colour 2048, the rest 1024)
// Output: the same shape as one RIVAL_HQ_DATA entry, so the game draws it with buildRivalCar().
import sharp from 'sharp';
// (v16.3: the plain CommonJS file. On Vercel the '.module.js' copy was read as CommonJS, so its named export wasn't found
// and every build was switched off: "Car building isn't switched on yet")
import meshoptEnc from 'meshoptimizer/meshopt_encoder.js';
const MeshoptEncoder = meshoptEnc.MeshoptEncoder || meshoptEnc;
import { MeshoptSimplifier } from 'meshopt-simplifier/simplifier';
import { readGLB } from './glb.js';

export const SIZES = { sports: 4.45, car: 4.75, suv: 4.9, truck: 5.9 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (arr, p) => { if (!arr.length) return NaN; const s = Float64Array.from(arr).sort(); return s[clamp(Math.round((s.length - 1) * p / 100), 0, s.length - 1)]; };
const median = (arr) => pct(arr, 50);
const r3 = (v) => Math.round(v * 1000) / 1000;

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 1e-6) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx > 0 ? d / mx : 0, mx];
}

// opts: { size: 'car' | ..., length (m, overrides size), flip (the model faces backwards) }
export async function bakeCar(glb, opts = {}) {
  const G = readGLB(glb), info = { tris: G.nt, verts: G.nv, dropped: G.dropped, notes: [] };
  let { P, N, UV, I } = G; const nv = G.nv;
  // ---- frame. The 3D services' frame: length along x with the nose at +x, up y. (A model that's longer along z is
  // taken as already facing +z.) Game: +z forward, x across.
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (let i = 0; i < nv; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z; }
  const alongX = (mxx - mnx) >= (mxz - mnz) * 0.87, rawL = alongX ? mxx - mnx : mxz - mnz;
  if (!(rawL > 1e-6)) throw new Error('empty model');
  const L = clamp(opts.length || SIZES[opts.size] || SIZES.car, 3.2, 7.5), s = L / rawL, cx = (mxx + mnx) / 2, cz = (mxz + mnz) / 2;
  const flip = opts.flip ? -1 : 1;
  const Pg = new Float64Array(nv * 3), Ng = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3] - cx, y = P[i * 3 + 1] - mny, z = P[i * 3 + 2] - cz, a = N[i * 3], b = N[i * 3 + 1], c = N[i * 3 + 2];
    if (alongX) { Pg[i * 3] = -z * s * flip; Pg[i * 3 + 1] = y * s; Pg[i * 3 + 2] = x * s * flip; Ng[i * 3] = -c * flip; Ng[i * 3 + 1] = b; Ng[i * 3 + 2] = a * flip; }
    else { Pg[i * 3] = x * s * flip; Pg[i * 3 + 1] = y * s; Pg[i * 3 + 2] = z * s * flip; Ng[i * 3] = a * flip; Ng[i * 3 + 1] = b; Ng[i * 3 + 2] = c * flip; }
  }
  P = Pg; N = Ng;
  let H = 0; for (let i = 0; i < nv; i++) H = Math.max(H, P[i * 3 + 1]);
  // too wide (the generated bodies are often fat): narrow it to 2.15 m across the doors, at most by 18%
  { const xs = []; for (let i = 0; i < nv; i++) { const y = P[i * 3 + 1], z = P[i * 3 + 2]; if (y > 0.15 * H && y < 0.5 * H && Math.abs(z) < 0.35 * L) xs.push(Math.abs(P[i * 3])); }
    const W = 2 * pct(xs, 97), k = W > 2.15 ? Math.max(0.82, 2.15 / W) : 1; info.width = r3(W * k);
    if (k < 1) { for (let i = 0; i < nv; i++) { P[i * 3] *= k; N[i * 3] /= k; const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; } info.notes.push('narrowed x' + k.toFixed(2)); } }

  // ---- the colour texture: a 1024 copy to read colours from
  if (!G.base) throw new Error('no colour texture');
  const TS = 1024, raw = await sharp(G.base).removeAlpha().resize(TS, TS, { fit: 'fill' }).raw().toBuffer();
  const texAt = (u, v) => { const x = clamp(Math.floor((u - Math.floor(u)) * (TS - 1)), 0, TS - 1), y = clamp(Math.floor((v - Math.floor(v)) * (TS - 1)), 0, TS - 1), o = (y * TS + x) * 3; return [raw[o] / 255, raw[o + 1] / 255, raw[o + 2] / 255]; };
  const C = new Float32Array(nv * 3), lum = new Float32Array(nv);
  for (let i = 0; i < nv; i++) { const c = texAt(UV[i * 2], UV[i * 2 + 1]); C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2]; lum[i] = (c[0] + c[1] + c[2]) / 3; }
  let Wh = 0; for (let i = 0; i < nv; i++) Wh = Math.max(Wh, Math.abs(P[i * 3]));

  // ---- wheels: the dark tyre ring standing on the ground in each corner
  const r0 = clamp(0.085 * L, 0.34, 0.56), wheels = [];
  for (const front of [true, false]) for (const sx of [1, -1]) {
    const side = [], low = [];
    for (let i = 0; i < nv; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (Math.sign(x) !== sx || Math.abs(x) < 0.6 * Wh || (z > 0) !== front || y > 1.9 * r0) continue;
      side.push(i); if (y < 0.03) low.push(z);
    }
    let zc = low.length >= 3 ? median(low) : (front ? 0.3 : -0.3) * L, r = r0, ok = false, ring = [];
    for (let it = 0; it < 10; it++) {
      ring = side.filter(i => lum[i] < 0.3 && (() => { const d = Math.hypot(P[i * 3 + 2] - zc, P[i * 3 + 1] - r); return d > 0.84 * r && d < 1.07 * r; })());
      if (ring.length < 12) break;
      // least squares circle (z, y) with the centre at height r: z^2 + y^2 = 2 zc z + 2 yc y + c
      let a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bb = [0, 0, 0];
      for (const i of ring) { const z = P[i * 3 + 2], y = P[i * 3 + 1], row = [-2 * z, -2 * y, 1], rhs = -(z * z + y * y); for (let p = 0; p < 3; p++) { bb[p] += row[p] * rhs; for (let q = 0; q < 3; q++) a[p][q] += row[p] * row[q]; } }
      const sol = solve3(a, bb); if (!sol) break;
      zc = sol[0]; r = clamp(sol[1], 0.26, 0.62); ok = true;
    }
    const ringOk = ok && ring.length >= 30 && r > 0.265 && r < 0.615;
    if (!ringOk) { r = r0; info.notes.push(`wheel ${front ? 'F' : 'R'}${sx > 0 ? 'L' : 'R'} estimated`); ring = side.filter(i => { const d = Math.hypot(P[i * 3 + 2] - zc, P[i * 3 + 1] - r); return d < 1.03 * r; }); }
    const ax = ring.map(i => Math.abs(P[i * 3]));
    const xo = ax.length > 10 ? pct(ax, 98) : Wh * 0.97, xi = ax.length > 10 ? pct(ax, 3) : Wh * 0.97 - 0.24;
    wheels.push({ front, sx, zc, yc: r, r, xo, xi: Math.min(xi, xo - 0.12), ok: ringOk });
  }
  for (const a of [0, 2]) { const w0 = wheels[a], w1 = wheels[a + 1]; for (const k of ['zc', 'yc', 'r', 'xo', 'xi']) { const v = (w0[k] + w1[k]) / 2; w0[k] = w1[k] = v; } }
  // a wheelbase that makes no sense (a ring fitted to something else): put the axles at the usual spots
  const wb = wheels[0].zc - wheels[2].zc;
  if (!(wb > 0.45 * L && wb < 0.75 * L)) { info.notes.push('wheelbase reset'); for (const w of wheels) { w.zc = (w.front ? 0.3 : -0.3) * L; w.r = w.yc = r0; } }
  const zmid = (wheels[0].zc + wheels[2].zc) / 2;
  for (let i = 0; i < nv; i++) P[i * 3 + 2] -= zmid;
  for (const w of wheels) w.zc -= zmid;

  // ---- the paint colour: the biggest colour on the doors (between the wheels, belt-line height). Colours are grouped
  // by hue (or by brightness when there's hardly any colour); near-black groups (glass, trim, tyres) count for less, so a
  // black car still wins only when black clearly dominates.
  const groups = new Map();
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (Math.abs(x) < 0.8 * Wh || Math.abs(z) > 0.25 * L || y < 0.3 * H || y > 0.8 * H) continue;
    const r = C[i * 3], g = C[i * 3 + 1], b = C[i * 3 + 2], [h, s_, v] = rgb2hsv(r, g, b);
    const k = s_ < 0.2 || v < 0.12 ? 'a' + Math.min(4, Math.floor(v * 5)) : 'c' + Math.floor(((h + 15) % 360) / 30) + (v < 0.3 ? 'd' : 'l');
    const e = groups.get(k) || { k, n: 0, r: 0, g: 0, b: 0 }; e.n++; e.r += r; e.g += g; e.b += b; groups.set(k, e);
  }
  const score = (e) => e.n * (Math.max(e.r, e.g, e.b) / e.n >= 0.2 ? 1 : e.k[0] === 'c' ? 0.8 : 0.35);   // (a deep green or blue is still paint)
  const pick = [...groups.values()].sort((a, b) => score(b) - score(a))[0];
  const ref = pick ? [pick.r / pick.n, pick.g / pick.n, pick.b / pick.n] : [0.5, 0.5, 0.5];
  const refHSV = rgb2hsv(...ref), chroma = refHSV[1] > 0.22 && refHSV[2] > 0.15;
  const isPaint = (r, g, b) => {
    const [h, s_, v] = rgb2hsv(r, g, b);
    if (chroma) { const dh = Math.abs(((h - refHSV[0]) + 540) % 360 - 180); return dh < 16 && s_ > refHSV[1] * 0.55 && v > refHSV[2] * 0.35 && v > 0.08; }
    return Math.abs(s_ - refHSV[1]) < 0.12 && Math.abs(v - refHSV[2]) < 0.2;
  };
  // ---- cut the generated wheels out (faces inside each tyre cylinder that aren't body paint)
  const paintV = new Uint8Array(nv); if (Math.max(...ref) > 0.25) for (let i = 0; i < nv; i++) paintV[i] = isPaint(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]) && Math.hypot(C[i * 3] - ref[0], C[i * 3 + 1] - ref[1], C[i * 3 + 2] - ref[2]) < 0.2 ? 1 : 0;
  const inside = new Uint8Array(nv);
  for (const w of wheels) for (let i = 0; i < nv; i++) {
    if (Math.sign(P[i * 3]) !== w.sx || Math.abs(P[i * 3]) < w.xi - 0.02) continue;
    if (Math.hypot(P[i * 3 + 2] - w.zc, P[i * 3 + 1] - w.yc) < w.r * 1.03) inside[i] = 1;
  }
  const keep = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (inside[a] && inside[b] && inside[c] && !(paintV[a] || paintV[b] || paintV[c])) continue;
    keep.push(a, b, c);
  }
  info.cut = (I.length - keep.length) / 3;
  const body = Uint32Array.from(keep);

  // ---- lamps: bright faces near the nose, red faces near the tail
  let zF = -Infinity, zR = Infinity; for (let i = 0; i < nv; i++) { zF = Math.max(zF, P[i * 3 + 2]); zR = Math.min(zR, P[i * 3 + 2]); }
  const faceC = (t) => { const a = body[t], b = body[t + 1], c = body[t + 2]; return [(P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3]; };
  const faceCol = (t) => { const a = body[t], b = body[t + 1], c = body[t + 2]; return [0, 1, 2].map(k => (C[a * 3 + k] + C[b * 3 + k] + C[c * 3 + k]) / 3); };
  const heads = [], tails = [];
  for (let t = 0; t < body.length; t += 3) {
    const f = faceC(t);
    if (f[2] > zF - 0.45 && f[1] > 0.3 * H && f[1] < 0.8 * H && Math.abs(f[0]) > 0.2) { const c = faceCol(t); if ((c[0] + c[1] + c[2]) / 3 > 0.72) heads.push(f); }
    if (f[2] < zR + 0.35 && f[1] > 0.25 * H && f[1] < 0.85 * H) { const c = faceCol(t); if (c[0] > 0.38 && c[0] - c[1] > 0.22 && c[0] - c[2] > 0.18) tails.push(f); }
  }
  const clusters = (F, front) => {
    const out = [];
    for (const sx of [1, -1]) {
      const q = F.filter(f => Math.sign(f[0]) === sx); if (q.length < 3) continue;
      const xs = q.map(f => f[0]), ys = q.map(f => f[1]), zs = q.map(f => f[2]);
      out.push([r3(median(xs)), r3(median(ys)), r3(pct(zs, front ? 90 : 10)), r3(clamp((pct(xs, 90) - pct(xs, 10)) / 2, 0.05, 0.22))]);
    }
    return out;
  };
  let head = clusters(heads, true), tail = clusters(tails, false);
  if (head.length < 2) { head = [1, -1].map(sx => [r3(sx * 0.62 * Wh), r3(clamp(0.42 * H, 0.5, 1.4)), r3(zF - 0.06), 0.11]); info.notes.push('headlamps estimated'); }
  if (tail.length < 2) { tail = [1, -1].map(sx => [r3(sx * 0.6 * Wh), r3(clamp(0.48 * H, 0.6, 1.5)), r3(zR + 0.05), 0.07]); info.notes.push('tail lamps estimated'); }
  const exhaust = [1, -1].map(sx => [r3(sx * 0.42 * Wh / 0.95), r3(clamp(0.2 * H, 0.26, 0.62)), r3(zR + 0.04)]);

  // ---- textures: colour 2048 (or the model's own size if smaller), ORM / normal / paint mask 1024, all WebP
  const meta0 = await sharp(G.base).metadata(), CS = Math.min(2048, Math.max(meta0.width || 1024, meta0.height || 1024));
  const webp = async (src, size, q, opts2 = {}) => 'data:image/webp;base64,' + (await sharp(src, opts2.raw ? { raw: opts2.raw } : undefined).removeAlpha().resize(size, size, { fit: 'fill' }).webp({ quality: q, effort: 5 }).toBuffer()).toString('base64');
  const tex = { map: await webp(G.base, CS, 84) };
  if (G.orm) tex.orm = await webp(G.orm, 1024, 82);
  if (G.nrm) tex.nrm = await webp(G.nrm, 1024, 86);
  // paint mask over the atlas: texels the colour of the paint (blurred a touch so its edges don't alias)
  const mask = Buffer.alloc(TS * TS); let mcount = 0;
  for (let p = 0; p < TS * TS; p++) { if (isPaint(raw[p * 3] / 255, raw[p * 3 + 1] / 255, raw[p * 3 + 2] / 255)) { mask[p] = 255; mcount++; } }
  tex.mask = 'data:image/webp;base64,' + (await sharp(mask, { raw: { width: TS, height: TS, channels: 1 } }).dilate(2).blur(1.2).webp({ quality: 85 }).toBuffer()).toString('base64');
  info.paintShare = r3(mcount / (TS * TS));

  // ---- pack: 16-byte vertices (pos u16 x3, -, uv u16 x2, normal i8 x3, -), meshopt; plus the far / shadow LOD
  const packed = await pack(P, N, UV, body);
  const data = {
    fmt: 'm67car', ver: 1, body: packed, glass: null, tex, paintRef: ref.map(r3),
    wheels: wheels.map(w => ({ x: r3(w.sx * (w.xo + w.xi) / 2), y: r3(w.yc), z: r3(w.zc), front: w.front, r: r3(w.r), w: r3(clamp(w.xo - w.xi, 0.18, 0.4)) })),
    head, tail, lamps: [], plate: null, decals: null, exhaust, zF: r3(zF), zR: r3(zR), halfW: r3(Wh), height: r3(H), length: r3(L),
  };
  info.wheels = data.wheels.map(w => [w.x, w.y, w.z, w.r, w.w]); info.ring = wheels.map(w => w.ok); info.paint = '#' + ref.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  info.triangles = packed.m;
  return { data, info };
}

function solve3(A, b) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null; [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

async function pack(P, N, UV, faces) {
  await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
  // the vertices the body uses, re-indexed
  const map = new Int32Array(P.length / 3).fill(-1), used = [];
  for (const v of faces) if (map[v] < 0) { map[v] = used.length; used.push(v); }
  const n = used.length, idx = new Uint32Array(faces.length); for (let i = 0; i < faces.length; i++) idx[i] = map[faces[i]];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of used) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[v * 3 + k]); hi[k] = Math.max(hi[k], P[v * 3 + k]); }
  const sc = lo.map((l, k) => Math.max(hi[k] - l, 1e-6)), lo5 = lo.map(v => Math.round(v * 1e5) / 1e5), sc5 = sc.map(v => Math.ceil(v * 1e5) / 1e5);
  let vtx = new Uint8Array(n * 16); const dv = new DataView(vtx.buffer);
  used.forEach((v, i) => {
    for (let k = 0; k < 3; k++) dv.setUint16(i * 16 + k * 2, clamp(Math.round((P[v * 3 + k] - lo5[k]) / sc5[k] * 65535), 0, 65535), true);
    dv.setUint16(i * 16 + 8, clamp(Math.round(clamp(UV[v * 2], 0, 1) * 65535), 0, 65535), true); dv.setUint16(i * 16 + 10, clamp(Math.round(clamp(UV[v * 2 + 1], 0, 1) * 65535), 0, 65535), true);
    for (let k = 0; k < 3; k++) dv.setInt8(i * 16 + 12 + k, clamp(Math.round(N[v * 3 + k] * 127), -127, 127));
  });
  const [remap, unique] = MeshoptEncoder.reorderMesh(idx, true, true);
  const v2 = new Uint8Array(unique * 16); for (let i = 0; i < n; i++) if (remap[i] !== 0xffffffff) v2.set(vtx.subarray(i * 16, i * 16 + 16), remap[i] * 16);
  vtx = v2;
  const res = { n: unique, m: idx.length / 3, lo: lo5, sc: sc5 };
  res.mi = Buffer.from(MeshoptEncoder.encodeIndexBuffer(new Uint8Array(idx.buffer), idx.length, 4)).toString('base64');
  // far / shadow LOD: a quarter of the triangles over the same vertices (UV-aware, allowed across seams)
  const u16 = new Uint16Array(vtx.buffer), pos = new Float32Array(unique * 3), uv = new Float32Array(unique * 2);
  for (let i = 0; i < unique; i++) { for (let k = 0; k < 3; k++) pos[i * 3 + k] = lo5[k] + u16[i * 8 + k] / 65535 * sc5[k]; uv[i * 2] = u16[i * 8 + 4] / 65535; uv[i * 2 + 1] = u16[i * 8 + 5] / 65535; }
  const [li] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, uv, 2, [1, 1], null, Math.floor(idx.length / 3 * 0.25) * 3, 0.01, ['Permissive']);
  res.ml = li.length / 3; res.mil = Buffer.from(MeshoptEncoder.encodeIndexBuffer(new Uint8Array(li.buffer, li.byteOffset, li.byteLength), li.length, 4)).toString('base64');
  res.mv = Buffer.from(MeshoptEncoder.encodeVertexBuffer(vtx, unique, 16)).toString('base64');
  return res;
}
