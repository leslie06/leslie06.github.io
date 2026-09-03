import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ItemSystem, type ItemKart, type ItemTrack } from './ItemSystem';
import { ItemBoxField } from './ItemBoxes';
import { ITEM_DEFS, type ItemId } from './ItemDefs';
import { createKartState, type KartState } from '../kart/kartStep';

const DT = 1 / 60;

/** 沿 +z 的直线赛道，长 1000m。t 和 z 是线性关系，方便摆位置 */
const track: ItemTrack = {
  length: 1000,
  sampleAt(t, out) {
    out.x = 0;
    out.z = (((t % 1) + 1) % 1) * 1000;
    out.heading = 0;
    return out;
  },
  progressAt(_x, z) {
    return (((z / 1000) % 1) + 1) % 1;
  },
};

function kart(id: string, z: number, place: number, useItem = false): ItemKart {
  const state: KartState = createKartState(0, z);
  return { id, state, trackT: track.progressAt(0, z), place, useItem };
}

/** 造一个只有一个箱子的系统，箱子摆在 z 处 */
function systemWithBox(z: number, seed = 1): ItemSystem {
  const boxes = new ItemBoxField([{ x: 0, y: 0, z }]);
  return new ItemSystem(track, boxes, { seed });
}

/** 强行把某人手里的道具换成指定的那个（测试要控制变量） */
function giveItem(sys: ItemSystem, karts: ItemKart[], id: string, item: ItemId): void {
  const box = new ItemBoxField([]);
  void box;
  // 通过公开接口塞不进去，直接改私有 slot —— 只有测试这么干
  const slots = (sys as unknown as { slots: Map<string, { held: ItemId | null }> }).slots;
  sys.register(id);
  slots.get(id)!.held = item;
  void karts;
}

describe('道具箱', () => {
  it('碾过去就发一个道具，箱子消失', () => {
    const sys = systemWithBox(100);
    const p = kart('p', 100, 4);
    sys.register('p');
    sys.update([p], DT);

    expect(sys.held('p')).not.toBeNull();
    expect(sys.boxes.boxes[0]!.active).toBe(false);
    expect(sys.consumeEvents().some((e) => e.type === 'pickup')).toBe(true);
  });

  it('隔了 respawnDelay 秒之后箱子重生', () => {
    const sys = systemWithBox(100);
    const p = kart('p', 100, 4);
    sys.register('p');
    sys.update([p], DT);
    expect(sys.boxes.boxes[0]!.active).toBe(false);

    const away = kart('p', 300, 4);
    const delay = sys.boxes.config.respawnDelay;
    for (let i = 0; i < Math.round((delay + 0.1) / DT); i++) sys.update([away], DT);
    expect(sys.boxes.boxes[0]!.active).toBe(true);
  });

  it('手里已经有道具就不再发货（箱子照样消失）', () => {
    const sys = systemWithBox(100);
    sys.register('p');
    giveItem(sys, [], 'p', 'shield');
    sys.update([kart('p', 100, 4)], DT);
    expect(sys.held('p')).toBe('shield');
    expect(sys.boxes.boxes[0]!.active).toBe(false);
  });

  it('离得远碰不到', () => {
    const sys = systemWithBox(100);
    sys.register('p');
    sys.update([kart('p', 130, 4)], DT);
    expect(sys.held('p')).toBeNull();
    expect(sys.boxes.boxes[0]!.active).toBe(true);
  });

  it('抽奖按名次加权：第一名永远抽不到闪电', () => {
    for (let seed = 0; seed < 40; seed++) {
      const sys = systemWithBox(100, seed);
      sys.register('p');
      sys.update([kart('p', 100, 1)], DT);
      expect(sys.held('p')).not.toBe('lightning');
    }
  });
});

describe('使用道具', () => {
  it('用掉之后手里就空了，并发出 use 事件', () => {
    const sys = systemWithBox(100);
    sys.register('p');
    giveItem(sys, [], 'p', 'shield');
    const p = kart('p', 300, 4, true);
    sys.update([p], DT);
    expect(sys.held('p')).toBeNull();
    expect(sys.consumeEvents().some((e) => e.type === 'use')).toBe(true);
  });

  it('空手按使用键不会有任何事发生', () => {
    const sys = systemWithBox(100);
    sys.register('p');
    sys.update([kart('p', 300, 4, true)], DT);
    expect(sys.consumeEvents()).toHaveLength(0);
  });

  it('boost 走的是漂移那套 state.boostTime，不是一个新机制', () => {
    const sys = systemWithBox(100);
    sys.register('p');
    giveItem(sys, [], 'p', 'boost');
    const p = kart('p', 300, 4, true);
    expect(p.state.boostTime).toBe(0);
    sys.update([p], DT);
    expect(p.state.boostTime).toBeGreaterThan(0);
    expect(p.state.boostLevel).toBe(3);
  });

  it('手上还有更久的 boost 时不会被换短（和漂移结算规则一致）', () => {
    const sys = systemWithBox(100);
    sys.register('p');
    giveItem(sys, [], 'p', 'boost');
    const p = kart('p', 300, 4, true);
    p.state.boostTime = 9;
    p.state.boostLevel = 3;
    sys.update([p], DT);
    expect(p.state.boostTime).toBe(9);
  });

  it('shield 挂在自己身上', () => {
    const sys = systemWithBox(100);
    sys.register('p');
    giveItem(sys, [], 'p', 'shield');
    sys.update([kart('p', 300, 4, true)], DT);
    expect(sys.effectsOf('p').has('shield')).toBe(true);
  });

  it('lightning 打到所有其他车，不打自己', () => {
    const sys = systemWithBox(100);
    const karts = [kart('a', 300, 3, true), kart('b', 400, 1), kart('c', 200, 5)];
    for (const k of karts) sys.register(k.id);
    giveItem(sys, karts, 'a', 'lightning');
    sys.update(karts, DT);

    expect(sys.effectsOf('a').has('slow')).toBe(false);
    expect(sys.effectsOf('b').has('slow')).toBe(true);
    expect(sys.effectsOf('c').has('slow')).toBe(true);
  });

  it('trap 放在使用者身后，不是脚下', () => {
    const sys = systemWithBox(100);
    // heading = 0 面朝 +z，所以"身后"是 -z
    const p = kart('p', 300, 4, true);
    sys.register('p');
    giveItem(sys, [], 'p', 'trap');
    sys.update([p], DT);

    expect(sys.traps).toHaveLength(1);
    expect(sys.traps[0]!.z).toBeLessThan(300);
    expect(300 - sys.traps[0]!.z).toBeCloseTo(4.5, 6);
  });

  it('站着不动丢雷不会把自己炸了', () => {
    // 这是真踩过的坑：雷放在脚下 + 只有 armDelay 的话，
    // 低速丢雷 0.6 秒后自己就在半径里，直接自爆
    const sys = systemWithBox(100);
    sys.register('p');
    giveItem(sys, [], 'p', 'trap');
    sys.update([kart('p', 300, 4, true)], DT);

    const still = kart('p', 300, 4);
    for (let i = 0; i < 120; i++) sys.update([still], DT); // 站两秒
    expect(sys.effectsOf('p').has('spinout')).toBe(false);
    expect(sys.traps).toHaveLength(1);
  });

  it('倒车退回自己刚放的雷上也不会自爆（ownerGrace）', () => {
    const sys = systemWithBox(100);
    sys.register('p');
    giveItem(sys, [], 'p', 'trap');
    sys.update([kart('p', 300, 4, true)], DT);
    const trapZ = sys.traps[0]!.z;

    // 起爆延迟过了，但还在 grace 里，直接倒到雷上
    for (let i = 0; i < 60; i++) sys.update([kart('p', 300, 4)], DT);
    sys.update([kart('p', trapZ, 4)], DT);
    expect(sys.effectsOf('p').has('spinout')).toBe(false);
  });

  it('grace 过了之后自己也会踩到（不能站在自己雷上无敌）', () => {
    const sys = systemWithBox(100);
    sys.register('p');
    giveItem(sys, [], 'p', 'trap');
    sys.update([kart('p', 300, 4, true)], DT);
    const trapZ = sys.traps[0]!.z;

    // 先在远处等到 grace 走完
    for (let i = 0; i < Math.round(3 / DT); i++) sys.update([kart('p', 340, 4)], DT);
    sys.update([kart('p', trapZ, 4)], DT);
    expect(sys.effectsOf('p').has('spinout')).toBe(true);
  });

  it('别的车碾到陷阱会失控，陷阱随之消失', () => {
    const sys = systemWithBox(100);
    const a = kart('a', 300, 4, true);
    const b = kart('b', 500, 2);
    sys.register('a');
    sys.register('b');
    giveItem(sys, [], 'a', 'trap');
    sys.update([a, b], DT);
    sys.consumeEvents();
    const trapZ = sys.traps[0]!.z;

    // 起爆延迟走完，再让 b 开到雷上
    const away = kart('a', 340, 4);
    for (let i = 0; i < 60; i++) sys.update([away, kart('b', 500, 2)], DT);
    sys.update([away, kart('b', trapZ, 2)], DT);

    expect(sys.effectsOf('b').has('spinout')).toBe(true);
    expect(sys.traps).toHaveLength(0);
  });

  it('别人不吃 grace：刚放下就撞上来的车照样中招', () => {
    const sys = systemWithBox(100);
    sys.register('a');
    sys.register('b');
    giveItem(sys, [], 'a', 'trap');
    sys.update([kart('a', 300, 4, true), kart('b', 500, 2)], DT);
    const trapZ = sys.traps[0]!.z;

    // 只等过 armDelay（0.6s），grace（2.5s）还早着呢
    for (let i = 0; i < 45; i++) sys.update([kart('a', 340, 4), kart('b', 500, 2)], DT);
    sys.update([kart('a', 340, 4), kart('b', trapZ, 2)], DT);
    expect(sys.effectsOf('b').has('spinout')).toBe(true);
  });
});

describe('投射物', () => {
  it('向前发射，锁定前方最近的车', () => {
    const sys = systemWithBox(100);
    const karts = [kart('me', 300, 3, true), kart('near', 340, 2), kart('far', 500, 1)];
    for (const k of karts) sys.register(k.id);
    giveItem(sys, karts, 'me', 'projectile');
    sys.update(karts, DT);

    expect(sys.projectiles).toHaveLength(1);
    expect(sys.projectiles[0]!.targetId).toBe('near');
    expect(sys.projectiles[0]!.ownerId).toBe('me');
  });

  it('飞过去打中目标，目标失控，投射物销毁', () => {
    const sys = systemWithBox(100);
    const karts = [kart('me', 300, 3, true), kart('t', 340, 2)];
    for (const k of karts) sys.register(k.id);
    giveItem(sys, karts, 'me', 'projectile');
    sys.update(karts, DT);
    sys.consumeEvents();

    const still = [kart('me', 300, 3), kart('t', 340, 2)];
    for (let i = 0; i < 120 && sys.projectiles.length > 0; i++) sys.update(still, DT);

    expect(sys.projectiles).toHaveLength(0);
    expect(sys.effectsOf('t').has('spinout')).toBe(true);
  });

  it('打不到人就会超时自毁，不会绕着赛道飞一辈子', () => {
    const sys = systemWithBox(100);
    const karts = [kart('me', 300, 3, true)];
    sys.register('me');
    giveItem(sys, karts, 'me', 'projectile');
    sys.update(karts, DT);
    expect(sys.projectiles).toHaveLength(1);

    const life = sys.projectiles[0]!.life;
    const still = [kart('me', 300, 3)];
    for (let i = 0; i < Math.round((life + 0.2) / DT); i++) sys.update(still, DT);
    expect(sys.projectiles).toHaveLength(0);
  });

  it('不会打到发射者自己', () => {
    const sys = systemWithBox(100);
    const karts = [kart('me', 300, 3, true), kart('t', 340, 2)];
    for (const k of karts) sys.register(k.id);
    giveItem(sys, karts, 'me', 'projectile');
    sys.update(karts, DT);
    const still = [kart('me', 300, 3), kart('t', 340, 2)];
    for (let i = 0; i < 120 && sys.projectiles.length > 0; i++) sys.update(still, DT);
    expect(sys.effectsOf('me').has('spinout')).toBe(false);
  });

  it('前方没车也照样发射（只是不锁定）', () => {
    const sys = systemWithBox(100);
    const karts = [kart('me', 300, 1, true), kart('behind', 100, 2)];
    for (const k of karts) sys.register(k.id);
    giveItem(sys, karts, 'me', 'projectile');
    sys.update(karts, DT);
    expect(sys.projectiles).toHaveLength(1);
    expect(sys.projectiles[0]!.targetId).toBeNull();
  });
});

describe('护盾挡伤害', () => {
  it('护盾挡下闪电，自己消失，不留减速', () => {
    const sys = systemWithBox(100);
    const karts = [kart('a', 300, 3, true), kart('b', 400, 1)];
    for (const k of karts) sys.register(k.id);
    sys.effectsOf('b').add({ type: 'shield', duration: 8, magnitude: 0 });
    giveItem(sys, karts, 'a', 'lightning');
    sys.update(karts, DT);

    expect(sys.effectsOf('b').has('slow')).toBe(false);
    expect(sys.effectsOf('b').has('shield')).toBe(false);
    const events = sys.consumeEvents();
    expect(events.some((e) => e.type === 'blocked' && e.kartId === 'b')).toBe(true);
    expect(events.some((e) => e.type === 'hit' && e.kartId === 'b')).toBe(false);
  });

  it('护盾只挡一次，第二发照样中', () => {
    const sys = systemWithBox(100);
    const setup = () => {
      const karts = [kart('a', 300, 3, true), kart('b', 400, 1)];
      for (const k of karts) sys.register(k.id);
      giveItem(sys, karts, 'a', 'lightning');
      sys.update(karts, DT);
    };
    sys.effectsOf('b').add({ type: 'shield', duration: 8, magnitude: 0 });
    setup();
    expect(sys.effectsOf('b').has('slow')).toBe(false);
    setup();
    expect(sys.effectsOf('b').has('slow')).toBe(true);
  });
});

describe('重开一局', () => {
  it('reset 清空道具、效果、场上实体，箱子全复活', () => {
    const sys = systemWithBox(100);
    const karts = [kart('a', 300, 3, true), kart('b', 400, 1)];
    for (const k of karts) sys.register(k.id);
    giveItem(sys, karts, 'a', 'trap');
    sys.update(karts, DT);
    sys.update([kart('a', 100, 3)], DT); // 顺便把箱子吃掉
    expect(sys.traps.length + sys.projectiles.length).toBeGreaterThan(0);

    sys.reset();
    expect(sys.traps).toHaveLength(0);
    expect(sys.projectiles).toHaveLength(0);
    expect(sys.held('a')).toBeNull();
    expect(sys.effectsOf('a').size).toBe(0);
    expect(sys.boxes.boxes.every((b) => b.active)).toBe(true);
    expect(sys.consumeEvents()).toHaveLength(0);
  });
});

describe('道具系统不改车的运动状态', () => {
  it('除了 boost 那两个字段，update 不碰 KartState', () => {
    const sys = systemWithBox(100);
    const p = kart('p', 100, 4);
    p.state.speed = 20;
    p.state.heading = 1.2;
    sys.register('p');
    sys.update([p], DT);
    // 拿到道具了，但车本身一动没动 —— 效果要等主循环把它写进 KartConfig 副本才生效
    expect(sys.held('p')).not.toBeNull();
    expect(p.state.speed).toBe(20);
    expect(p.state.heading).toBe(1.2);
    expect(p.state.x).toBe(0);
    expect(p.state.z).toBe(100);
  });
});

/** 去掉注释，只留代码 —— 文档里提到道具名是正常的，代码里分支才是问题 */
function codeOf(url: URL): string {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('ItemDefs 是唯一的分支点', () => {
  it('ItemSystem 里不出现任何具体道具 id —— 加新道具不用改它', () => {
    const src = codeOf(new URL('./ItemSystem.ts', import.meta.url));
    for (const id of Object.keys(ITEM_DEFS)) {
      // 找的是字符串字面量。'boost' 作为 grantBoost / boostTime 的一部分不算
      expect(src, `ItemSystem.ts 里出现了 '${id}'`).not.toMatch(
        new RegExp(`['\"\`]${id}['\"\`]`),
      );
    }
  });

  it('渲染层和 HUD 也不按 id 分支，颜色图标都从表里取', () => {
    for (const file of ['../ui/ItemHud.ts', '../render/ItemViews.ts']) {
      const src = codeOf(new URL(file, import.meta.url));
      for (const id of Object.keys(ITEM_DEFS)) {
        expect(src, `${file} 里出现了 '${id}'`).not.toMatch(
          new RegExp(`['\"\`]${id}['\"\`]`),
        );
      }
    }
  });
});
