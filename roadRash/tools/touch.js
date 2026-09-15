/* ---------------------------------------------------------------------------
   手机触摸：在真 Chromium 里造手指事件，查摇杆和按住式按键会不会卡住。

   假 DOM 里没有触摸事件，这一类毛病 fuzz 和 playtest 都查不出来。「玩一会儿摇杆就
   不灵了」就是它：系统吞掉一次抬手（划出屏幕边、iOS 三指手势、底部横条），摇杆就
   一直认着那根早就不在的手指，之后怎么按都没反应，舵量停在最后那个值。

   要 Playwright。本仓库不装依赖：先找全局的，再找隔壁 drive-city 的；都没有就跳过。
   用法：node tools/touch.js
   --------------------------------------------------------------------------- */
'use strict';
const path = require('path');
let chromium = null;
for (const p of ['playwright', path.join(__dirname, '..', '..', 'drive-city', 'node_modules', 'playwright')]) {
  try { chromium = require(p).chromium; break; } catch (e) {}
}
if (!chromium) { console.log('  - 没找到 Playwright，跳过触摸测试'); process.exit(0); }

const URL = 'file://' + path.join(__dirname, '..', 'index.html');
let bad = 0;
const say = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) bad++; };

(async () => {
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { console.log('  - 浏览器起不来，跳过触摸测试：' + e.message.split('\n')[0]); process.exit(0); }
  const errs = [];
  for (const [nm, vp] of [['横屏', { width: 844, height: 390 }], ['竖屏', { width: 390, height: 844 }]]) {
    console.log(nm);
    const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(nm + '：' + e.message));
    await page.goto(URL); await page.waitForTimeout(300);
    await page.evaluate(() => startRace(0)); await page.waitForTimeout(100);
    const st = () => page.evaluate(() => { const r = steerEl.getBoundingClientRect();
      return { steer: touchState.steer, id: steerId, brk: touchState.brk, r: r.right, cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: r.width / 2 }; });
    const home = await st();

    /* 合成事件：可以只发按下不发抬起，模拟被系统吞掉的那一下。alive 是这时屏幕上还按着的手指 */
    const fire = (type, target, id, x, y, alive) => page.evaluate(([type, target, id, x, y, alive]) => {
      const el = document.getElementById(target);
      const mk = (i, xx, yy) => new Touch({ identifier: i, target: el, clientX: xx, clientY: yy });
      const touches = alive.map(a => mk(a[0], a[1], a[2]));
      el.dispatchEvent(new TouchEvent(type, { changedTouches: [mk(id, x, y)], touches, targetTouches: touches, bubbles: true, cancelable: true }));
    }, [type, target, id, x, y, alive]);
    const L = home.cx - home.R * .7, Rx = home.cx + home.R * .7, Y = home.cy;

    await fire('touchstart', 'steerZone', 2, home.cx, Y, [[2, home.cx, Y]]);
    await fire('touchmove', 'steerZone', 2, L, Y, [[2, L, Y]]);                 // 往左推着，抬手丢了
    await fire('touchstart', 'steerZone', 3, home.cx, Y, [[3, home.cx, Y]]);
    await fire('touchmove', 'steerZone', 3, Rx, Y, [[3, Rx, Y]]);
    let s = await st();
    say(s.steer > .9 && s.id === 3, '上一根手指的抬起丢了，重新按下照样能转（' + s.steer + '）');
    await fire('touchend', 'steerZone', 3, Rx, Y, []);
    s = await st(); say(s.steer === 0 && s.id === null, '之后抬手能回中');

    await fire('touchstart', 'steerZone', 0, L, Y, [[0, L, Y]]);                // 安卓复用编号
    await fire('touchstart', 'steerZone', 0, Rx, Y, [[0, Rx, Y]]);
    s = await st(); say(s.steer > .9, '手指编号被复用时，新按下那一下按落点算（' + s.steer + '）');
    await fire('touchend', 'steerZone', 0, Rx, Y, []);

    const b = await page.evaluate(() => { const r = document.getElementById('kBrk').getBoundingClientRect(); return [r.left + 8, r.top + 8]; });
    await fire('touchstart', 'kBrk', 7, b[0], b[1], [[7, b[0], b[1]]]);
    await fire('touchstart', 'steerZone', 8, home.cx, Y, [[8, home.cx, Y]]);
    s = await st(); say(!s.brk, '刹车的抬起丢了，下一次触摸就松开，不会一直踩着');
    await fire('touchend', 'steerZone', 8, home.cx, Y, []);

    /* 真多指（CDP）：左手推摇杆，右手同时连点踹人 */
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const kick = await page.evaluate(() => { const r = document.getElementById('kAtkR').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    let stuck = 0;
    for (let round = 0; round < 20; round++) {
      const p = { x: home.cx, y: Y, id: 1 };
      await T('touchStart', [p]);
      for (let k = 0; k < 5; k++) {
        p.x = home.cx + Math.sin(k + round) * home.R * .8;
        await T('touchMove', [p]);
        await T('touchStart', [p, { x: kick.x, y: kick.y, id: 2 }]);
        await T('touchEnd', [p]);
      }
      await T('touchEnd', []);
      s = await st(); if (s.id !== null || s.steer !== 0) stuck++;
    }
    say(stuck === 0, '左手推摇杆、右手连点踹人 20 轮，抬手后都回中（卡住 ' + stuck + ' 轮）');

    /* 触控区比圆宽：拇指落点往右漂也接得住，从回中开始，圆不压到够得着的对手 */
    const zr = await page.evaluate(() => steerZone.getBoundingClientRect().right);
    const x = nm === '横屏' ? vp.width * .36 : zr - 10, y = Y - 20;   // 竖屏的圆大，36% 还在圆里
    await T('touchStart', [{ x, y, id: 4 }]);
    s = await st();
    say(s.id === 4 && s.steer === 0, '拇指落在圆外远处（' + (x / vp.width * 100).toFixed(0) + '% 屏宽）接得住，从回中开始');
    if (nm === '横屏') say(s.r <= vp.width * .27 + 1, '横屏画出来的圆不越过 27% 屏宽（' + (s.r / vp.width * 100).toFixed(1) + '%）');
    await T('touchMove', [{ x: x + home.R * .7, y, id: 4 }]); s = await st(); const right = s.steer;
    await T('touchMove', [{ x: x - home.R * .7, y, id: 4 }]); s = await st();
    say(right > .9 && s.steer < -.9, '从落点左右推都能满舵（' + right + ' / ' + s.steer + '）');
    await T('touchEnd', []); s = await st();
    say(s.steer === 0 && Math.abs(s.cx - home.cx) < 1, '抬手回中、圆回原位');
    say(await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [kick.x, kick.y]) === 'kAtkR', '踹人键没被触控区盖住');
    await ctx.close();
  }
  await browser.close();
  say(!errs.length, '页面没有报错' + (errs.length ? '：' + errs.join(' | ') : ''));
  process.exit(bad ? 1 : 0);
})();
