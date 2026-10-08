// Read a GLB (binary glTF 2.0) made by the 3D service into flat arrays: positions, normals, UVs and triangles in
// world space, plus the embedded textures of the main material. Data only: nothing in the file is ever fetched or run
// (a file that points at outside URLs, or uses compression we didn't ask for, is refused).
const MAX_BYTES = 120 * 1024 * 1024, MAX_TRIS = 600000;

export function readGLB(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 20 || buf.length > MAX_BYTES) throw new Error('model file size');
  if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2) throw new Error('not a glTF 2 binary');
  let off = 12, json = null, bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a && !json) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942 && !bin) bin = body;
    off += 8 + len;
  }
  if (!json || !bin) throw new Error('glTF chunks missing');
  const req = json.extensionsRequired || [];
  if (req.some(e => !/^KHR_materials_|^KHR_texture_transform$|^KHR_mesh_quantization$/.test(e))) throw new Error('unsupported extension ' + req.join(','));
  for (const b of json.buffers || []) if (b.uri) throw new Error('external buffer');
  for (const im of json.images || []) if (im.uri) throw new Error('external image');

  const views = json.bufferViews || [], accs = json.accessors || [];
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function read(ai) {
    const a = accs[ai]; if (!a || a.bufferView === undefined) throw new Error('accessor');
    const bv = views[a.bufferView], nc = NCOMP[a.type], ct = a.componentType;
    const size = { 5126: 4, 5125: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1 }[ct]; if (!size || !nc) throw new Error('accessor type');
    const stride = bv.byteStride || size * nc, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    if (base + stride * (a.count - 1) + size * nc > (bv.byteOffset || 0) + bv.byteLength || (bv.byteOffset || 0) + bv.byteLength > bin.length) throw new Error('accessor range');
    const out = new Float64Array(a.count * nc), norm = !!a.normalized;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < nc; k++) {
      const o = base + i * stride + k * size; let v;
      switch (ct) {
        case 5126: v = bin.readFloatLE(o); break;
        case 5125: v = bin.readUInt32LE(o); break;
        case 5123: v = bin.readUInt16LE(o); if (norm) v /= 65535; break;
        case 5122: v = bin.readInt16LE(o); if (norm) v = Math.max(v / 32767, -1); break;
        case 5121: v = bin.readUInt8(o); if (norm) v /= 255; break;
        case 5120: v = bin.readInt8(o); if (norm) v = Math.max(v / 127, -1); break;
      }
      out[i * nc + k] = v;
    }
    return { a: out, n: nc, count: a.count };
  }
  // world matrices of the mesh nodes
  const M = (m) => m, mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  function local(n) {
    if (n.matrix) return M(n.matrix.slice());
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  }
  const inst = [], nodes = json.nodes || [];
  const scene = (json.scenes || [])[json.scene || 0];
  const roots = scene ? scene.nodes : nodes.map((_, i) => i);
  const walk = (i, parent, depth) => {
    if (depth > 32 || !nodes[i]) return;
    const w = mul(parent, local(nodes[i]));
    if (nodes[i].mesh !== undefined) inst.push({ mesh: nodes[i].mesh, m: w });
    for (const c of nodes[i].children || []) walk(c, w, depth + 1);
  };
  for (const r of roots || []) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);

  // the main material: the one covering the most triangles that has a colour texture
  const prims = [];
  for (const it of inst) for (const p of (json.meshes[it.mesh] || {}).primitives || []) {
    if (p.mode !== undefined && p.mode !== 4) continue;
    if (p.attributes.POSITION === undefined || p.attributes.TEXCOORD_0 === undefined) continue;
    const tris = (p.indices !== undefined ? accs[p.indices].count : accs[p.attributes.POSITION].count) / 3;
    prims.push({ p, m: it.m, tris, mat: p.material ?? -1 });
  }
  const byMat = {};
  for (const q of prims) { const mt = (json.materials || [])[q.mat]; if (!mt || !mt.pbrMetallicRoughness || !mt.pbrMetallicRoughness.baseColorTexture) continue; byMat[q.mat] = (byMat[q.mat] || 0) + q.tris; }
  const best = Object.keys(byMat).sort((a, b) => byMat[b] - byMat[a])[0];
  if (best === undefined) throw new Error('no textured mesh');
  const use = prims.filter(q => String(q.mat) === best), dropped = prims.length - use.length;
  const total = use.reduce((s, q) => s + q.tris, 0); if (total > MAX_TRIS) throw new Error('model too detailed (' + total + ' triangles)');

  let nv = 0, nt = 0; for (const q of use) { nv += accs[q.p.attributes.POSITION].count; nt += q.tris; }
  const P = new Float64Array(nv * 3), N = new Float64Array(nv * 3), UV = new Float64Array(nv * 2), I = new Uint32Array(nt * 3);
  let vo = 0, io = 0;
  for (const q of use) {
    const pos = read(q.p.attributes.POSITION), uv = read(q.p.attributes.TEXCOORD_0), nr = q.p.attributes.NORMAL !== undefined ? read(q.p.attributes.NORMAL) : null;
    const m = q.m, cnt = pos.count;
    for (let i = 0; i < cnt; i++) {
      const x = pos.a[i * 3], y = pos.a[i * 3 + 1], z = pos.a[i * 3 + 2];
      P[(vo + i) * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]; P[(vo + i) * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; P[(vo + i) * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      UV[(vo + i) * 2] = uv.a[i * 2]; UV[(vo + i) * 2 + 1] = uv.a[i * 2 + 1];
      if (nr) { const a = nr.a[i * 3], b = nr.a[i * 3 + 1], c = nr.a[i * 3 + 2]; N[(vo + i) * 3] = m[0] * a + m[4] * b + m[8] * c; N[(vo + i) * 3 + 1] = m[1] * a + m[5] * b + m[9] * c; N[(vo + i) * 3 + 2] = m[2] * a + m[6] * b + m[10] * c; }
    }
    if (q.p.indices !== undefined) { const ix = read(q.p.indices); for (let i = 0; i < ix.count; i++) { const v = ix.a[i]; if (v >= cnt) throw new Error('index range'); I[io + i] = v + vo; } io += ix.count; }
    else { for (let i = 0; i < cnt; i++) I[io + i] = vo + i; io += cnt; }
    if (!nr) computeNormals(P, N, I, vo, vo + cnt);
    vo += cnt;
  }
  for (let i = 0; i < nv; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }

  const mat = json.materials[+best], pbr = mat.pbrMetallicRoughness;
  const img = (ti) => {
    const t = (json.textures || [])[ti]; if (!t) return null;
    const src = t.source ?? (t.extensions && (t.extensions.EXT_texture_webp || {}).source); const im = (json.images || [])[src]; if (!im || im.bufferView === undefined) return null;
    const bv = views[im.bufferView], b = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), h = b.subarray(0, 12).toString('hex');
    // (only plain JPEG, PNG or WebP pictures are read)
    return h.startsWith('ffd8ff') || h.startsWith('89504e47') || (h.startsWith('52494646') && b.subarray(8, 12).toString() === 'WEBP') ? b : null;
  };
  return {
    P, N, UV, I, nv, nt,
    base: img(pbr.baseColorTexture.index),
    orm: pbr.metallicRoughnessTexture ? img(pbr.metallicRoughnessTexture.index) : null,
    nrm: mat.normalTexture ? img(mat.normalTexture.index) : null,
    factors: { metal: pbr.metallicFactor ?? 1, rough: pbr.roughnessFactor ?? 1 },
    dropped,
  };
}

function computeNormals(P, N, I, v0, v1) {
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2]; if (a < v0 || a >= v1) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; }
  }
}
