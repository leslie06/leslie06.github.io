// 名片街验收：FROZEN=1 npm run dev -- --port 5198，然后 node scripts/qa/famous.mjs [desktop|phone]
// 从标题进入真实帧循环；瞬移只用于换测试地点，柜台开关、购买和走路使用实际输入。
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const phone = process.argv[2] === 'phone';
const out = `.scratch/streetlevel/accept-${phone ? 'phone' : 'desktop'}`;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [], results = [];
try {
  const context = await browser.newContext(phone
    ? { viewport: { width: 851, height: 393 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'zh-CN' }
    : { viewport: { width: 1280, height: 720 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
  await page.goto(`http://127.0.0.1:5198/?lang=zh&nostat&lb=0&intro=0&resume=0&campaign=0&npc=0&events=0&title=1&quality=${phone ? 'low&lite=1&touch=1' : 'high'}&tod=14`);
  await page.waitForFunction(() => !!window.drivecity, null, { timeout: 180000 });
  const start = page.getByText(/进入城市|开始游戏|START|ENTER/).first();
  if (phone) await start.tap(); else await start.click();
  await page.waitForFunction(() => window.drivecity.get('ui').state === 'playing');
  await page.waitForTimeout(3000);
  if (phone) await page.locator('.touch .qf').tap(); else await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.drivecity.get('player').mode === 'onfoot');
  // 测试存档准备购买预算；购买本身仍通过面板按钮完成。
  await page.evaluate(() => window.drivecity.get('missions').addCash(1000));

  // 从游戏已编译的片元着色器提取选招牌的代码，在独立 WebGL2 上与 worker 算法逐项对照。
  // 包含 2^23 前后及 24 位最大值，能抓到 uint(vSeed + 0.5) 对奇数种子的舍入错误。
  const gpu = await page.evaluate(async () => {
    const { GLSL_HASH, hash3 } = await import('/src/city/visual/hash.ts');
    const { signIndex } = await import('/src/city/visual/ShopSigns.ts');
    const e = window.drivecity, gameGL = e.renderer.getContext();
    const source = e.renderer.info.programs.map((p) => gameGL.getShaderSource(p.fragmentShader)).find((s) => s?.includes('uint flav ='));
    if (!source) throw new Error('未找到实际立面着色器');
    const seedLine = source.match(/uint seed = [^;]+;/)[0];
    const choose = source.slice(source.indexOf('uint flav ='), source.indexOf('vec2 q = vec2(clamp(qx'));
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const gl = cv.getContext('webgl2');
    const compile = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;precision highp int;uniform float vSeed, flags;uniform uint unit;out vec4 pixel;${GLSL_HASH}\nvoid main(){${seedLine}uint hs=cityHash3(seed,unit+4096u,555u);bool fam=(uint(flags)&512u)!=0u;${choose}\npixel=vec4(float(idx)/255.,0.,0.,1.);}`));
    gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program); gl.disable(gl.DITHER); gl.viewport(0, 0, 1, 1);
    const seedU = gl.getUniformLocation(program, 'vSeed'), flagU = gl.getUniformLocation(program, 'flags'), unitU = gl.getUniformLocation(program, 'unit'), pixel = new Uint8Array(4);
    const seeds = [0, 1, 8388607, 8388608, 8388609, 8388611, 16777215];
    let checked = 0;
    for (const seed of seeds) for (let flavour = 0; flavour <= 8; flavour++) for (const famous of [false, true]) for (let unit = 0; unit < 16; unit++) {
      gl.uniform1f(seedU, seed); gl.uniform1f(flagU, flavour * 32 + (famous ? 512 : 0)); gl.uniform1ui(unitU, unit);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const expected = signIndex(hash3(seed, unit + 4096, 555), flavour, famous);
      if (pixel[0] !== expected) throw new Error(`招牌不符 seed=${seed} flavour=${flavour} unit=${unit} famous=${famous}: GPU ${pixel[0]} / worker ${expected}`);
      checked++;
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { checked };
  });
  console.log('GPU 招牌一致性', JSON.stringify(gpu));

  for (const name of ['烟袋斜街', '簋街', '三里屯酒吧街']) {
    const state = await page.evaluate(async (name) => {
      const { FAMOUS, pointOn, lineLength } = await import('/src/city/Famous.ts');
      const { SHOP_STRIDE } = await import('/src/city/Buildings.ts');
      const { shopSigns } = await import('/src/city/visual/ShopSigns.ts');
      const { SERVICE } = await import('/src/street/Trades.ts');
      const e = window.drivecity, f = FAMOUS.find((f) => f.name.zh === name), signs = shopSigns();
      const p = pointOn(f.pts, lineLength(f.pts) * 0.5, f.walk ? 0 : f.infill.front - 2.4, { x: 0, z: 0, dx: 0, dz: 0 });
      await e.get('world').preload(p.x, p.z);
      e.get('player').setRiding(null, { ...p, y: 0.4, yaw: Math.atan2(p.dx, p.dz) });
      await new Promise((r) => setTimeout(r, 4000));
      const units = [], unusable = [];
      for (const list of e.get('world').streamer.shops.values()) for (let i = 0; i < list.length; i += SHOP_STRIDE) {
        if (!(list[i + 7] & 8) || Math.hypot(list[i] - p.x, list[i + 1] - p.z) > 100) continue;
        const sign = signs[list[i + 6]];
        if ((list[i + 7] & 1) || !sign || !SERVICE[sign.trade]) unusable.push(sign?.text ?? '无招牌');
        units.push({ x: list[i], z: list[i + 1], nx: list[i + 2], nz: list[i + 3], room: list[i + 9], sign: sign?.text, service: SERVICE[sign?.trade] });
      }
      units.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      return { id: f.id, p, count: units.length, unusable, units: units.filter((u) => u.service === 'eat').slice(0, 3), strollers: e.get('strollers')?.debug() };
    }, name);
    assert.deepEqual(state.unusable, [], `${name} 有不能互动的名片街店面`);
    assert.equal(state.units.length, 3, `${name} 食店样本不足`);
    await page.screenshot({ path: `${out}/${state.id}-day.png` });
    // 真正按住前进三秒，检查角色没有卡在新增墙体里。
    const before = await page.evaluate(() => { const p = window.drivecity.get('player').position; return { x: p.x, z: p.z }; });
    if (phone) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 300, id: 0 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 240, id: 0 }] });
      await page.waitForTimeout(3000);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    } else { await page.keyboard.down('KeyW'); await page.waitForTimeout(3000); await page.keyboard.up('KeyW'); }
    const moved = await page.evaluate((before) => { const p = window.drivecity.get('player').position; return Math.hypot(p.x - before.x, p.z - before.z); }, before);
    assert.ok(moved > 4, `${name} 前进只有 ${moved.toFixed(2)} 米`);
    let opened = 0;
    for (const [k, u] of state.units.entries()) {
      await page.evaluate((u) => { const e = window.drivecity, d = Math.min(1.5, Math.max(0.8, u.room - 0.3)); e.get('player').setRiding(null, { x: u.x + u.nx * d, y: 0.4, z: u.z + u.nz * d, yaw: Math.atan2(-u.nx, -u.nz) }); }, u);
      await page.waitForTimeout(1800);
      const prompt = await page.evaluate(() => window.drivecity.get('player').prompt);
      assert.ok(prompt?.includes(u.sign), `期待 ${u.sign}，实际提示 ${prompt}`);
      if (phone) await page.locator('.touch .action').tap(); else await page.keyboard.press('KeyF');
      const panel = page.locator('.nl-panel:not([hidden])');
      await panel.waitFor({ state: 'visible' });
      assert.equal(await panel.locator('.sign').textContent(), u.sign);
      if (!k) {
        await page.screenshot({ path: `${out}/${state.id}-counter.png` });
        const bought = await page.evaluate(() => window.drivecity.get('street').saved.bought);
        const item = panel.locator('.items button').filter({ has: page.locator('.p', { hasText: /^¥\d/ }) }).first();
        if (phone) await item.tap(); else await item.click();
        await page.waitForFunction((n) => window.drivecity.get('street').saved.bought === n, bought + 1, { timeout: 3000 });
      }
      const leave = panel.locator('.leave');
      await leave.scrollIntoViewIfNeeded();
      if (phone) await leave.tap(); else await leave.click();
      await panel.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.drivecity.paused), false);
      opened++;
    }
    await page.evaluate((p) => { const e = window.drivecity; e.get('player').setRiding(null, { ...p, y: 0.4, yaw: Math.atan2(p.dx, p.dz) }); e.get('render').timeOfDay = 21; }, state.p);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${out}/${state.id}-night.png` });
    if (phone) {
      await page.getByRole('button', { name: '地图', exact: true }).tap();
      await page.locator('.navmap .close').tap();
      await page.waitForFunction(() => !window.drivecity.get('nav').mapOpen);
      // 竖屏柜台也必须能关闭（通过真实按钮），检查页面没有横向溢出。
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(1000);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${out}/${state.id}-portrait.png` });
      await page.evaluate((u) => window.drivecity.get('player').setRiding(null, { x: u.x + u.nx * 1.4, y: 0.4, z: u.z + u.nz * 1.4, yaw: Math.atan2(-u.nx, -u.nz) }), state.units[0]);
      await page.waitForTimeout(1800);
      await page.locator('.touch .action').tap();
      const portraitPanel = page.locator('.nl-panel:not([hidden])');
      await portraitPanel.waitFor({ state: 'visible' });
      await page.screenshot({ path: `${out}/${state.id}-portrait-counter.png` });
      await portraitPanel.locator('.leave').scrollIntoViewIfNeeded();
      await portraitPanel.locator('.leave').tap();
      await portraitPanel.waitFor({ state: 'hidden' });
      await page.setViewportSize({ width: 851, height: 393 });
    }
    await page.evaluate(() => { window.drivecity.get('render').timeOfDay = 14; });
    const result = { name, shops: state.count, opened, moved: +moved.toFixed(1), strollers: state.strollers };
    results.push(result); console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors, [], '浏览器错误');
  fs.writeFileSync(`${out}/report.json`, JSON.stringify({ gpu, results, errors }, null, 2));
} finally { await browser.close(); }
