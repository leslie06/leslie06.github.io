// 首都机场（2026-11-16，设计见 docs/airport-design.md）：从 OSM 的 aeroway 要素算出机场的地面、空侧范围、围界和
// public/city/airfield.json。build.mjs 在读完 OSM 之后、处理道路之前调用 airfield()。
//
// 空侧（围界里）怎么划：OSM 的机场多边形（aeroway=aerodrome）把 T2、T3 的车道边、停车场、货运区都圈在里面，不能拿它
// 当围界。按 4 米的格子：机场多边形里，去掉公共道路两边 30 米和停车场（但跑道、滑行道、机坪 12 米以内的不去）、去掉
// 航站楼，做一次 10 米的开运算去掉细条，只留和跑道连着的那几块，再把里面小的空洞（被空侧围住的楼、T3D）填上。
// 围界沿这块的边走；空侧里的路（勤务道）不进路网，画成水泥带。
import polygonClipping from 'polygon-clipping';

const CELL = 4;
/** 公共道路（陆侧）：这些等级的车行道两边 30 米算陆侧。service 不算（空侧的勤务道都是 service）。 */
const PUBLIC = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street']);
const HALF = { motorway: 6, motorway_link: 4, trunk: 6, trunk_link: 4, primary: 7, primary_link: 4, secondary: 5, secondary_link: 3.5, tertiary: 4, tertiary_link: 3.5, unclassified: 3.5, residential: 3, living_street: 2.5, service: 2.5 };
/** 滑行道 OSM 没标宽度：按 23 米画（E 类机的滑行道道面）。 */
const TAXI_W = 23;
/** 航站楼的高度（OSM 没有）：按名字。 */
const TERMINAL_H = [[/3号航站楼/, 38], [/2号航站楼/, 30], [/卫星厅|1号航站楼/, 20], [/公务机|专机/, 14], [/远机位/, 10]];

const EMPTY = { found: false, inAero: () => false, airside: () => false, dropRoad: () => false, areas: [], fence: [], json: null, stats: {} };

export function airfield(env) {
  const { ways, rels, nodes, proj, openRing, assemble, signedArea, pip, bboxOf } = env;
  // ---------------------------------------------------------------- 机场多边形
  let aero = null, aeroId = 0;
  for (const w of ways) if (w.tags?.aeroway === 'aerodrome' && w.geometry?.length >= 4 && w.nodes[0] === w.nodes.at(-1)) { aero = [openRing(proj(w.geometry))]; aeroId = w.id; }
  for (const r of rels) if (!aero && r.tags?.aeroway === 'aerodrome') {
    const rings = assemble(r.members.filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => proj(m.geometry)));
    if (rings.length) { aero = rings; aeroId = r.id; }
  }
  if (!aero) return EMPTY;

  // ---------------------------------------------------------------- 格子
  let [X0, Z0, X1, Z1] = bboxOf(aero.flat());
  X0 -= 300; Z0 -= 300; X1 += 300; Z1 += 300;
  const NX = Math.ceil((X1 - X0) / CELL), NZ = Math.ceil((Z1 - Z0) / CELL), N = NX * NZ;
  const mask = () => new Uint8Array(N);
  /** 多边形（几个环按奇偶规则）填进格子：格子中心在里面就算。 */
  const fill = (m, rings, v = 1) => {
    const bb = bboxOf(rings.flat());
    const j0 = Math.max(0, Math.floor((bb[1] - Z0) / CELL)), j1 = Math.min(NZ - 1, Math.ceil((bb[3] - Z0) / CELL));
    for (let j = j0; j <= j1; j++) {
      const z = Z0 + (j + 0.5) * CELL, xs = [];
      for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const p = r[a], q = r[b];
        if ((p[1] > z) !== (q[1] > z)) xs.push(p[0] + (q[0] - p[0]) * (z - p[1]) / (q[1] - p[1]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - X0) / CELL - 0.5)), i1 = Math.min(NX - 1, Math.floor((xs[k + 1] - X0) / CELL - 0.5));
        for (let i = i0; i <= i1; i++) m[j * NX + i] = v;
      }
    }
  };
  /** 一条宽 2·hw 的线。 */
  const thick = (m, P, hw, v = 1) => {
    for (let k = 0; k + 1 < P.length; k++) {
      const [ax, az] = P[k], [bx, bz] = P[k + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - X0) / CELL)), i1 = Math.min(NX - 1, Math.ceil((Math.max(ax, bx) + hw - X0) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - hw - Z0) / CELL)), j1 = Math.min(NZ - 1, Math.ceil((Math.max(az, bz) + hw - Z0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = X0 + (i + 0.5) * CELL, z = Z0 + (j + 0.5) * CELL;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= hw) m[j * NX + i] = v;
      }
    }
  };
  /** 到最近的置位格子的距离（米，8 邻域倒角近似）。 */
  const dist = (m) => {
    const d = new Float32Array(N), D = Math.SQRT2 * CELL;
    for (let k = 0; k < N; k++) d[k] = m[k] ? 0 : 1e9;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i; let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + CELL);
      if (j > 0) { v = Math.min(v, d[k - NX] + CELL); if (i > 0) v = Math.min(v, d[k - NX - 1] + D); if (i < NX - 1) v = Math.min(v, d[k - NX + 1] + D); }
      d[k] = v;
    }
    for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
      const k = j * NX + i; let v = d[k];
      if (i < NX - 1) v = Math.min(v, d[k + 1] + CELL);
      if (j < NZ - 1) { v = Math.min(v, d[k + NX] + CELL); if (i < NX - 1) v = Math.min(v, d[k + NX + 1] + D); if (i > 0) v = Math.min(v, d[k + NX - 1] + D); }
      d[k] = v;
    }
    return d;
  };
  /** 四连通的连通块：每格的块号（0 不在 m 里），和每块的格数。 */
  const components = (m) => {
    const lab = new Int32Array(N), size = [0];
    const st = new Int32Array(N);
    let n = 0;
    for (let s = 0; s < N; s++) {
      if (!m[s] || lab[s]) continue;
      n++; let top = 0, c = 0; st[top++] = s; lab[s] = n;
      while (top) {
        const k = st[--top]; c++;
        const i = k % NX, j = (k - i) / NX;
        if (i > 0 && m[k - 1] && !lab[k - 1]) { lab[k - 1] = n; st[top++] = k - 1; }
        if (i < NX - 1 && m[k + 1] && !lab[k + 1]) { lab[k + 1] = n; st[top++] = k + 1; }
        if (j > 0 && m[k - NX] && !lab[k - NX]) { lab[k - NX] = n; st[top++] = k - NX; }
        if (j < NZ - 1 && m[k + NX] && !lab[k + NX]) { lab[k + NX] = n; st[top++] = k + NX; }
      }
      size.push(c);
    }
    return { lab, size };
  };

  // ---------------------------------------------------------------- 要素
  const isClosed = (w) => w.nodes?.length >= 4 && w.nodes[0] === w.nodes.at(-1);
  const runways = [], taxiways = [], aprons = [], stands = [], bridges = [], terminals = [];
  const nodeIx = new Map(), NODES = [];
  const nid = (id, x, z) => { let k = nodeIx.get(id); if (k === undefined) { k = NODES.length / 2; nodeIx.set(id, k); NODES.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10); } return k; };
  const inAeroRaw = (x, z) => aero.some((r) => pip(x, z, r));
  const ABB = bboxOf(aero.flat()), near = ([x, z]) => x > ABB[0] - 500 && x < ABB[2] + 500 && z > ABB[1] - 500 && z < ABB[3] + 500;
  for (const w of ways) {
    const t = w.tags; if (!t?.aeroway || !w.geometry || w.geometry.length < 2) continue;
    const P = proj(w.geometry);
    if (!near(P[0])) continue;
    if (t.aeroway === 'runway' || t.aeroway === 'stopway') runways.push({ id: w.id, ref: t.ref ?? '', P, w: parseFloat(t.width) || 60, ids: w.nodes, stop: t.aeroway === 'stopway' });
    else if (t.aeroway === 'taxiway') taxiways.push({ id: w.id, ref: t.ref ?? '', P, w: parseFloat(t.width) || TAXI_W, ids: w.nodes });
    else if (t.aeroway === 'apron' && isClosed(w)) aprons.push({ id: w.id, rings: [openRing(P)] });
    else if (t.aeroway === 'parking_position') stands.push({ ref: t.ref ?? t.name ?? '', P });
    else if (t.aeroway === 'jet_bridge') bridges.push({ ref: t.ref ?? '', P });
    // 只要首都机场里的：老框里也读进了带 building 的 aeroway（南苑机场的机库），不能动它们（老地块会变）
    if ((t.aeroway === 'terminal' || t.aeroway === 'hangar' || t.aeroway === 'tower') && t.building && inAeroRaw(...P[0])) terminals.push({ id: w.id, t, rings: isClosed(w) ? [openRing(P)] : [] });
  }
  for (const r of rels) {
    const t = r.tags; if (!t?.aeroway) continue;
    const outer = assemble(r.members.filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => proj(m.geometry)));
    const inner = assemble(r.members.filter((m) => m.type === 'way' && m.geometry && m.role === 'inner').map((m) => proj(m.geometry)));
    if (t.aeroway === 'apron') for (const o of outer) if (near(o[0])) aprons.push({ id: r.id, rings: [o, ...inner.filter((h) => pip(h[0][0], h[0][1], o))] });
    if ((t.aeroway === 'terminal' || t.aeroway === 'hangar') && t.building && outer.length && inAeroRaw(...outer[0][0])) terminals.push({ id: r.id, t, rings: [...outer, ...inner] });
  }
  for (const n of nodes) if (n.tags?.aeroway === 'parking_position') { const [x, z] = env.project(n.lat, n.lon); if (near([x, z])) stands.push({ ref: n.tags.ref ?? n.tags.name ?? '', P: [[x, z]] }); }
  // 航站楼、机库、塔台：给高度，按站房画（第二批换成 Blender 地标）
  for (const T of terminals) {
    const t = T.t;
    if (!(parseFloat(t.height) > 0)) {
      const hit = TERMINAL_H.find(([re]) => re.test(t.name ?? ''));
      t.height = String(t.aeroway === 'hangar' ? 28 : hit ? hit[1] : 14);
    }
    if (t.aeroway !== 'hangar') t.building = 'transportation';
    else t.building = 'industrial';
  }

  // ---------------------------------------------------------------- 空侧
  const A = mask(); fill(A, aero);
  const S = mask();
  for (const r of runways) thick(S, r.P, r.w / 2);
  for (const t of taxiways) thick(S, t.P, t.w / 2);
  for (const a of aprons) fill(S, a.rings);
  const RW = mask(); for (const r of runways) if (!r.stop) thick(RW, r.P, r.w / 2);
  const L = mask();
  for (const w of ways) {
    const t = w.tags; if (!t?.highway || !w.geometry) continue;
    if (t.tunnel && t.tunnel !== 'no') continue;
    if (Number(t.layer) < 0 && !(t.bridge && t.bridge !== 'no')) continue;
    if (PUBLIC.has(t.highway)) thick(L, proj(w.geometry), HALF[t.highway] + 30);
  }
  for (const w of ways) if (w.tags?.amenity === 'parking' && isClosed(w) && !w.tags.highway) fill(L, [openRing(proj(w.geometry))]);
  const TERM = mask();
  for (const T of terminals) if (T.t.aeroway === 'terminal' && T.rings.length) fill(TERM, T.rings);
  const dS = dist(S);
  let AIR = mask();
  for (let k = 0; k < N; k++) AIR[k] = A[k] && !(L[k] && dS[k] > 12) && !TERM[k] ? 1 : 0;
  // 开运算 10 米：去掉陆侧缓冲之间的细条
  {
    const dOut = dist(AIR.map((v) => 1 - v));
    const core = mask(); for (let k = 0; k < N; k++) core[k] = dOut[k] > 10 ? 1 : 0;
    const dIn = dist(core);
    for (let k = 0; k < N; k++) AIR[k] = AIR[k] && dIn[k] <= 10 + CELL ? 1 : 0;
  }
  // 只留和跑道连着的块
  {
    const { lab } = components(AIR), keep = new Set();
    for (let k = 0; k < N; k++) if (RW[k] && lab[k]) keep.add(lab[k]);
    for (let k = 0; k < N; k++) AIR[k] = keep.has(lab[k]) ? 1 : 0;
  }
  // 被空侧围住的小块（楼、T3D 这种卫星厅）填上：不碰格子边、小于 8 万平方米、里面没有公共道路
  {
    const inv = AIR.map((v) => 1 - v), { lab, size } = components(inv);
    const bad = new Set();
    for (let i = 0; i < NX; i++) { bad.add(lab[i]); bad.add(lab[(NZ - 1) * NX + i]); }
    for (let j = 0; j < NZ; j++) { bad.add(lab[j * NX]); bad.add(lab[j * NX + NX - 1]); }
    for (let k = 0; k < N; k++) if (lab[k] && L[k] && !TERM[k]) bad.add(lab[k]);
    for (let k = 0; k < N; k++) if (lab[k] && !bad.has(lab[k]) && size[lab[k]] * CELL * CELL < 80000) AIR[k] = 1;
  }
  const airside = (x, z) => {
    const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
    return i >= 0 && j >= 0 && i < NX && j < NZ && AIR[j * NX + i] === 1;
  };
  const inAero = (x, z) => {
    const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
    return i >= 0 && j >= 0 && i < NX && j < NZ && A[j * NX + i] === 1;
  };

  // ---------------------------------------------------------------- 边界：格子边连成环（沿 d 走时格子在 (dz, -dx) 一侧），再化简
  const rings = [];
  {
    const out = new Map();   // 起点顶点 -> 有向边终点
    const V = (i, j) => j * (NX + 1) + i;
    const add = (a, b) => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
    const at = (i, j) => i >= 0 && j >= 0 && i < NX && j < NZ && AIR[j * NX + i] === 1;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      if (!at(i, j)) continue;
      // x 向右、z 向下；顺着走时格子在左手边
      if (!at(i, j - 1)) add(V(i + 1, j), V(i, j));
      if (!at(i, j + 1)) add(V(i, j + 1), V(i + 1, j + 1));
      if (!at(i - 1, j)) add(V(i, j), V(i, j + 1));
      if (!at(i + 1, j)) add(V(i + 1, j + 1), V(i + 1, j));
    }
    const xy = (v) => { const i = v % (NX + 1), j = (v - i) / (NX + 1); return [X0 + i * CELL, Z0 + j * CELL]; };
    for (const [s0] of out) {
      while (out.get(s0)?.length) {
        const loop = [s0];
        let prev = s0, cur = out.get(s0).pop();
        let guard = 0;
        while (cur !== s0 && guard++ < 1e7) {
          loop.push(cur);
          const l = out.get(cur);
          if (!l?.length) break;
          // 鞍点上有两条出边：选向左拐的那条（同一块的边界不和对角的另一块连上）
          let pick = l.length - 1;
          if (l.length > 1) {
            const [px, pz] = xy(prev), [cx, cz] = xy(cur);
            const dx = cx - px, dz = cz - pz;
            pick = l.findIndex((n) => { const [nx, nz] = xy(n); return dx * (nz - cz) - dz * (nx - cx) < 0; });
            if (pick < 0) pick = l.length - 1;
          }
          prev = cur; cur = l.splice(pick, 1)[0];
          if (!l.length) out.delete(prev);
        }
        if (cur === s0 && loop.length >= 4) rings.push(loop.map(xy));
      }
      out.delete(s0);
    }
  }
  const dp = (P, tol) => {
    if (P.length < 3) return P;
    const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
    const st = [[0, P.length - 1]];
    while (st.length) {
      const [a, b] = st.pop();
      let bi = -1, bd = tol;
      const [ax, az] = P[a], [bx, bz] = P[b], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      for (let k = a + 1; k < b; k++) {
        const t = Math.max(0, Math.min(1, ((P[k][0] - ax) * dx + (P[k][1] - az) * dz) / L2));
        const d = Math.hypot(P[k][0] - ax - dx * t, P[k][1] - az - dz * t);
        if (d > bd) { bd = d; bi = k; }
      }
      if (bi >= 0) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
    }
    return P.filter((_, k) => keep[k]);
  };
  // 闭环化简：从离起点最远的点切开成两段分别化简
  const simplifyLoop = (R, tol) => {
    let far = 0, fd = -1;
    for (let k = 0; k < R.length; k++) { const d = Math.hypot(R[k][0] - R[0][0], R[k][1] - R[0][1]); if (d > fd) { fd = d; far = k; } }
    const a = dp(R.slice(0, far + 1), tol), b = dp([...R.slice(far), R[0]], tol);
    return [...a, ...b.slice(1, -1)];
  };
  const fence = [], outers = [], holes = [];
  // 围界贴着航站楼走的那几段不要（楼本身就是界）：一段的两头和中点都在航站楼 6 米以内就去掉，环在那里断开成几条线
  const dT = dist(TERM);
  const nearTerm = (x, z) => {
    const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
    return i >= 0 && j >= 0 && i < NX && j < NZ && dT[j * NX + i] <= 6;
  };
  for (const R of rings) {
    const S2 = simplifyLoop(R, 2.5);
    if (S2.length < 3) continue;
    const a = signedArea(S2);
    if (Math.abs(a) < 400) continue;
    const along = S2.map((p, k) => { const q = S2[(k + 1) % S2.length]; return nearTerm(...p) && nearTerm(...q) && nearTerm((p[0] + q[0]) / 2, (p[1] + q[1]) / 2); });
    const k0 = along.indexOf(true);
    if (k0 < 0) fence.push([...S2, S2[0]]);
    else {
      // 从一段「贴楼」的后面开始绕一圈，把不贴楼的连续段切出来
      let run = [];
      for (let s = 1; s <= S2.length; s++) {
        const k = (k0 + s) % S2.length;
        if (along[k]) { if (run.length) { run.push(S2[k]); if (run.length >= 2) fence.push(run); run = []; } }
        else { if (!run.length) run.push(S2[k]); run.push(S2[(k + 1) % S2.length]); }
      }
      if (run.length >= 2) fence.push(run);
    }
    // 上面那样走，外环的有向面积是负的、洞是正的（build.mjs 自己会把外环翻成正的）
    (a < 0 ? outers : holes).push(S2);
  }

  // ---------------------------------------------------------------- 地面
  const areas = [];
  let aid = 9.7e12;
  const union = (polys) => { try { return polygonClipping.union(...polys.map((p) => [p])); } catch { return []; } };
  const close = (r) => [...r, r[0]];
  /** 一条线展成带：每段一个长方形加每个顶点一个八边形，并起来。 */
  const strip = (P, hw) => {
    const polys = [];
    for (let k = 0; k + 1 < P.length; k++) {
      const [ax, az] = P[k], [bx, bz] = P[k + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const nx = -(bz - az) / L * hw, nz = (bx - ax) / L * hw;
      polys.push(close([[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]]));
    }
    for (let k = 1; k + 1 < P.length; k++) {
      const oct = [];
      for (let s = 0; s < 8; s++) oct.push([P[k][0] + Math.cos(s * Math.PI / 4 + Math.PI / 8) * hw, P[k][1] + Math.sin(s * Math.PI / 4 + Math.PI / 8) * hw]);
      polys.push(close(oct));
    }
    return polys;
  };
  // 并出来的多边形：一串长方形加八边形并起来，边上有很多共线的碎点，里面贴着边留下几平方米的小洞——三角化的时候小洞把外环拉出
  // 尖刺（滑行道边上一片锯齿状的暗块，2026-11-16）。小洞（< 80 m²）不要，环按 0.3 米化简。
  const pushMP = (k, mp) => {
    for (const poly of mp) {
      const outer = simplifyLoop(poly[0].slice(0, -1), 0.3);
      if (outer.length < 3 || Math.abs(signedArea(outer)) < 4) continue;
      const hs = poly.slice(1).map((h) => h.slice(0, -1)).filter((h) => Math.abs(signedArea(h)) >= 80).map((h) => simplifyLoop(h, 0.3)).filter((h) => h.length >= 3);
      areas.push({ k, outer, holes: hs, id: aid++ });
    }
  };
  // 跑道（和停止道）
  for (const r of runways) pushMP('runway', union(strip(r.P, r.w / 2)));
  // 滑行道：每条一并，跟跑道一个材质（同一材质重叠看不出来）
  for (const t of taxiways) pushMP('runway', union(strip(t.P, t.w / 2)));
  // 机坪
  for (const a of aprons) areas.push({ k: 'apron', outer: a.rings[0], holes: a.rings.slice(1), id: aid++ });

  // ---------------------------------------------------------------- 空侧的路
  const airRoads = [];
  const fracAir = (P) => {
    let n = 0, a = 0;
    for (let k = 0; k + 1 < P.length; k++) {
      const [ax, az] = P[k], [bx, bz] = P[k + 1], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 5));
      for (let s = 0; s < m; s++) { const x = ax + (bx - ax) * s / m, z = az + (bz - az) * s / m; n++; if (airside(x, z)) a++; }
    }
    return n ? a / n : 0;
  };
  const dropped = new Set();
  const dropStats = {};
  for (const w of ways) {
    const t = w.tags; if (!t?.highway || !w.geometry || w.geometry.length < 2) continue;
    // 只丢 service：公共道路一律留着（货运北路的隧道口有一小段落在空侧里，丢了路就断了；围界在它上面留个口子）
    if (t.highway !== 'service') continue;
    if (t.tunnel && t.tunnel !== 'no') continue;
    const P = proj(w.geometry);
    if (!P.some(([x, z]) => inAero(x, z))) continue;
    const f = fracAir(P);
    if (f >= 0.5) {
      dropped.add(w.id);
      dropStats[t.highway] = (dropStats[t.highway] ?? 0) + 1;
      const hw = (parseFloat(t.width) || 6) / 2;
      airRoads.push({ P, hw });
    }
  }
  // 勤务道画成水泥带（和机坪一个材质）；只画不在机坪上的部分没必要，重叠看不出来
  for (const r of airRoads) pushMP('apron', union(strip(r.P, r.hw)));
  // 机坪（和空侧勤务道）里挖掉跑道、滑行道：两层大片重叠的话，几百米外深度精度只有几厘米，1 毫米高差加一格偏移分不开，
  // 滑行道边上一片三角形的锯齿（2026-11-16）。不重叠就不打架。
  {
    const rw = areas.filter((a) => a.k === 'runway').map((a) => ({ poly: [close(a.outer), ...a.holes.map(close)], bb: bboxOf(a.outer) }));
    for (let i = areas.length - 1; i >= 0; i--) {
      const a = areas[i];
      if (a.k !== 'apron') continue;
      const bb = bboxOf(a.outer);
      const hit = rw.filter((r) => !(r.bb[0] > bb[2] || r.bb[2] < bb[0] || r.bb[1] > bb[3] || r.bb[3] < bb[1]));
      if (!hit.length) continue;
      let res;
      try { res = polygonClipping.difference([close(a.outer), ...a.holes.map(close)], ...hit.map((r) => r.poly)); } catch { continue; }
      const parts = [];
      for (const poly of res) {
        const outer = simplifyLoop(poly[0].slice(0, -1), 0.3);
        if (outer.length < 3 || Math.abs(signedArea(outer)) < 4) continue;
        parts.push({ k: 'apron', outer, holes: poly.slice(1).map((h) => h.slice(0, -1)).filter((h) => Math.abs(signedArea(h)) >= 4), id: a.id });
      }
      areas.splice(i, 1, ...parts);
    }
  }

  // 场内的草：空侧整块（不挖铺装：和机坪的偏移差 2.7 格、高差 1 厘米，没打架；一次减一千多个多边形 polygon-clipping 会抛异常）
  for (const o of outers) areas.push({ k: 'field', outer: o, holes: holes.filter((h) => pip(h[0][0], h[0][1], o)), id: aid++ });

  // ---------------------------------------------------------------- airfield.json
  const q = (v) => Math.round(v * 10) / 10;
  const fl = (P) => P.flatMap(([x, z]) => [q(x), q(z)]);
  const json = {
    v: 1,
    aerodrome: aeroId,
    nodes: [],
    runways: runways.filter((r) => !r.stop).map((r) => ({ ref: r.ref, w: r.w, p: fl(r.P), n: r.ids.map((id, k) => nid(id, ...r.P[k])) })),
    stopways: runways.filter((r) => r.stop).map((r) => ({ w: r.w, p: fl(r.P) })),
    taxiways: taxiways.map((t) => ({ ref: t.ref, w: t.w, p: fl(t.P), n: t.ids.map((id, k) => nid(id, ...t.P[k])) })),
    // 机位：停机点（线的最后一个点，点要素就是那个点）和机头朝向（沿线从滑行道指向停机点）
    stands: stands.map((s) => {
      const e = s.P.at(-1), b = s.P.length > 1 ? s.P.at(-2) : null;
      const yaw = b ? Math.atan2(e[0] - b[0], e[1] - b[1]) : null;
      return { ref: s.ref, x: q(e[0]), z: q(e[1]), ...(yaw !== null ? { yaw: Math.round(yaw * 1000) / 1000 } : {}) };
    }),
    bridges: bridges.map((b) => ({ ref: b.ref, p: fl(b.P) })),
    terminals: terminals.filter((T) => T.rings.length).map((T) => { const bb = bboxOf(T.rings[0]); return { name: T.t.name ?? '', ref: T.t.ref ?? '', kind: T.t.aeroway, c: [q((bb[0] + bb[2]) / 2), q((bb[1] + bb[3]) / 2)], h: parseFloat(T.t.height) }; }),
    roads: airRoads.map((r) => ({ w: q(r.hw * 2), p: fl(r.P) })),
    fence: fence.map(fl),
  };
  json.nodes = NODES;

  return {
    found: true, inAero, airside, dropRoad: (w) => dropped.has(w.id), areas, fence, json,
    stats: { cells: N, airKm2: AIR.reduce((a, v) => a + v, 0) * CELL * CELL / 1e6, rings: rings.length, fenceLines: fence.length, fenceKm: Math.round(fence.reduce((a, P) => a + P.slice(1).reduce((b, p, k) => b + Math.hypot(p[0] - P[k][0], p[1] - P[k][1]), 0), 0)) / 1000, outers: outers.length, holes: holes.length, runways: runways.length, taxiways: taxiways.length, aprons: aprons.length, stands: stands.length, bridges: bridges.length, terminals: terminals.length, dropped: dropStats, areas: areas.length },
  };
}
