// 片区口味（src/city/visual/Flavours.ts，docs/street-level-design.md B4）：一串圆 [x, z, 半径, 口味]，先到先得。
//   node scripts/city/flavours.mjs
// 读 public/city/places.json（学校、医院、写字楼的点）和 network.json（有名字的路），写 src/city/visual/flavours.gen.json。
// 口味编号是 ShopSigns.ts 的 FLAVOURS 的下标 + 1：1 高校 2 写字楼 3 电子城 4 餐饮街 5 酒吧街 6 胡同 7 城乡结合部 8 医院。
// 不是 build.mjs 的一步：改了下面的表或者重建了城市再跑。改完要重启开发服务器（worker 里打包了这份数据）。
import fs from 'node:fs';
const F = { campus: 1, office: 2, tech: 3, food: 4, bar: 5, hutong: 6, fringe: 7, hospital: 8 };
/** 手工指定的名街：路名（network.json 里的全名或正则）→ 口味，沿路每 50 米一个半径 `r` 的圆。 */
const STREETS = [
  [/^东直门内大街$/, F.food, 55],          // 簋街
  [/^(三里屯路|三里屯北街|三里屯南街|工人体育场北路|工人体育场东路)$/, F.bar, 60],
  [/^(后海北沿|后海南沿|前海北沿|前海南沿|烟袋斜街|鸦儿胡同)$/, F.bar, 45],
  [/^(中关村大街|海淀大街|中关村南大街|知春路|海淀中街)$/, F.tech, 65],
  [/^(成府路|学院路|学清路|双清路)$/, F.campus, 60],
  [/^(鼓楼东大街|鼓楼西大街|地安门外大街|方家胡同|五道营胡同|北新桥头条|交道口南大街)$/, F.hutong, 45],
  [/^(前门大街|大栅栏街|大栅栏西街|煤市街|鲜鱼口街)$/, F.hutong, 45],
  [/^(金融大街|建国门外大街|光华路|东三环中路|望京街|阜通东大街|丽泽路)$/, F.office, 70],
  [/^(牛街|广安门内大街)$/, F.food, 50],
];
const places = JSON.parse(fs.readFileSync('public/city/places.json', 'utf8'));
const net = JSON.parse(fs.readFileSync('public/city/network.json', 'utf8'));
const out = [];
// 上下行两条线、相邻两段会放出几乎重合的圆：25 米格子里同一种口味只留一个
const seen = new Set();
const put = (x, z, r, f) => { const k = `${Math.round(x / 25)}_${Math.round(z / 25)}_${f}`; if (seen.has(k)) return; seen.add(k); out.push(Math.round(x), Math.round(z), Math.round(r), f); };

// 1. 名街
let streetCircles = 0;
for (const e of net.edges) {
  if (!e.n) continue;
  const hit = STREETS.find(([re]) => re.test(e.n));
  if (!hit) continue;
  const p = e.p; let carry = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az);
    for (let s = carry; s < L; s += 50) { put(ax + (bx - ax) * s / L, az + (bz - az) * s / L, hit[2], hit[1]); streetCircles++; }
    carry = (carry - L) % 50; if (carry < 0) carry += 50;
  }
}
// 2. 医院、高校：占地折成圆，再往外一圈
const cat = (name) => places.cats.indexOf(name);
let nHosp = 0, nCampus = 0;
for (const [x, z, c, , ha, name] of places.p) {
  if (c === cat('hospital') && ha >= 0.8) { put(x, z, Math.sqrt(ha * 10000 / Math.PI) + 160, F.hospital); nHosp++; }
}
for (const [x, z, c, , ha, name] of places.p) {
  if (c === cat('school') && /大学|学院/.test(name) && ha >= 6) { put(x, z, Math.sqrt(ha * 10000 / Math.PI) + 220, F.campus); nCampus++; }
}
// 3. 写字楼扎堆：300 米的格子里 4 个以上写字楼、酒店、商场的点
const cells = new Map();
for (const [x, z, c] of places.p) {
  if (c !== cat('office') && c !== cat('hotel') && c !== cat('mall')) continue;
  const k = `${Math.floor(x / 300)}_${Math.floor(z / 300)}`;
  cells.set(k, (cells.get(k) ?? 0) + 1);
}
let nOffice = 0;
for (const [k, n] of cells) { if (n < 4) continue; const [cx, cz] = k.split('_').map(Number); put(cx * 300 + 150, cz * 300 + 150, 240, F.office); nOffice++; }

fs.writeFileSync('src/city/visual/flavours.gen.json', JSON.stringify({ z: out }));
console.log(`flavours: ${out.length / 4} circles (streets ${streetCircles}, hospitals ${nHosp}, campuses ${nCampus}, office cells ${nOffice}), ${(JSON.stringify({ z: out }).length / 1024).toFixed(0)} KB`);
