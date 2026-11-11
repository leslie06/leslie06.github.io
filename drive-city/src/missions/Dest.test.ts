import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Rng } from '../core/Rng';
import type { Place, PlaceCat } from '../nav/Places';
import { catWeights, kerbReach, placeLabel, rankPlaces, usable } from './Dest';

const place = (zh: string, cat: PlaceCat, x = 0, z = 0, rank = 3, en = '', ha = 0): Place => ({ x, z, cat, rank, ha, name: { zh, en: en || zh } });

describe('乘客去哪', () => {
  it('只要名字像个能打车去的地方的', () => {
    const ok = [place('芍药居北里', 'resid'), place('协和医院', 'hospital'), place('北京大学', 'school'), place('朝外SOHO', 'office'), place('老挝大使馆', 'office'),
      place('六里屯派出所', 'gov'), place('团结湖公园', 'park'), place('北京康莱德酒店', 'hotel'), place('北京古代建筑博物馆', 'sight'), place('双井', 'metro')];
    const no = [place('5号楼', 'hotel'), place('报账大厅（大财务）', 'office'), place('牺牲所大殿柱础', 'sight'), place('链家', 'office'), place('S3', 'mall'),
      place('汉庭酒店(北京亚运村店)', 'hotel'), place('建外', 'area'), place('南信号站', 'rail'), place('朝阳区垂杨柳中心小学馨园分校高部', 'school'), place('森林公园南门', 'park')];
    for (const p of ok) expect(usable(p, true), p.name.zh).toBe(true);
    for (const p of no) expect(usable(p, true), p.name.zh).toBe(false);
  });

  it('英文界面只要有英文名、不太长的', () => {
    expect(usable(place('芍药居北里', 'resid', 0, 0, 3, 'Shaoyaoju Beili'), false)).toBe(true);
    expect(usable(place('芍药居北里', 'resid'), false)).toBe(false);
    expect(usable(place('朝阳医院', 'hospital', 0, 0, 1, 'Beijing Chao-Yang Hospital, Capital Medical University'), false)).toBe(false);
  });

  it('地铁站统一叫「某某地铁站」', () => {
    expect(placeLabel(place('双井', 'metro', 0, 0, 1, 'Shuangjing'), true)).toBe('双井地铁站');
    expect(placeLabel(place('长春桥站', 'metro', 0, 0, 1, 'Changchunqiao Station'), true)).toBe('长春桥地铁站');
    expect(placeLabel(place('长春桥站', 'metro', 0, 0, 1, 'Changchunqiao Station'), false)).toBe('Changchunqiao Station');
    expect(placeLabel(place('双井', 'metro', 0, 0, 1, 'Shuangjing'), false)).toBe('Shuangjing Station');
    expect(placeLabel(place('协和医院', 'hospital'), true)).toBe('协和医院');
  });

  it('只挑范围里的，不重复，被跳过的不挑', () => {
    const ps = [place('甲小区', 'resid', 500, 0), place('乙小区', 'resid', 5000, 0), place('丙小区', 'resid', 100, 0), place('丁医院', 'hospital', 0, 900), place('戊小区', 'resid', 700, 700)];
    const rng = new Rng(7);
    const got = rankPlaces(ps, 0, 0, 300, 1500, 12, () => rng.next(), true, 8, (p) => p.name.zh === '戊小区');
    expect(got.map((p) => p.name.zh).sort()).toEqual(['丁医院', '甲小区']);
  });

  it('钟点的口味：早上写字楼多，夜里小区多；小区再多也盖不过别的类', () => {
    const ps: Place[] = [];
    for (let i = 0; i < 200; i++) ps.push(place(`小区${i}号院`, 'resid', 400 + i, 0));
    for (let i = 0; i < 10; i++) ps.push(place(`某某大厦${'甲乙丙丁戊己庚辛壬癸'[i]}座`, 'office', 0, 400 + i));
    const first = (hour: number) => {
      const rng = new Rng(11); let office = 0;
      for (let k = 0; k < 400; k++) if (rankPlaces(ps, 0, 0, 300, 1500, hour, () => rng.next(), true, 1)[0].cat === 'office') office++;
      return office / 400;
    };
    expect(first(8)).toBeGreaterThan(0.75);     // 4 : 0.6
    expect(first(23)).toBeLessThan(0.1);        // 0.2 : 5
    expect(catWeights(3).school).toBeUndefined();
  });

  it('占地大的地方找路边找得远', () => {
    expect(kerbReach(place('某小区', 'resid'))).toBe(150);
    expect(kerbReach(place('朝阳公园', 'park', 0, 0, 0, '', 236))).toBeGreaterThan(800);
    expect(kerbReach(place('奥林匹克森林公园', 'park', 0, 0, 0, '', 614))).toBe(900);
  });

  // 真数据：全城各处、各个钟点都挑得出地方来
  const file = fileURLToPath(new URL('../../public/city/places.json', import.meta.url));
  it.skipIf(!fs.existsSync(file))('真的 places.json：能去的有几千个，城里到处、什么钟点都挑得出', () => {
    const d = JSON.parse(fs.readFileSync(file, 'utf8')) as { cats: string[]; p: [number, number, number, number, number, string, string][] };
    const all: Place[] = d.p.map(([x, z, c, rank, ha, zh, en]) => ({ x, z, cat: d.cats[c] as PlaceCat, rank, ha, name: { zh, en: en || zh } }));
    const good = all.filter((p) => usable(p, true));
    expect(good.length).toBeGreaterThan(3000);
    expect(all.filter((p) => usable(p, false)).length).toBeGreaterThan(1500);
    const rng = new Rng(3);
    // 国贸、西单、中关村、望京、丰台
    for (const [x, z] of [[4300, -300], [-2400, 200], [-7000, -8000], [6500, -9000], [-8000, 6000]]) {
      for (const hour of [3, 8, 13, 19, 23]) {
        expect(rankPlaces(all, x, z, 320, 800, hour, () => rng.next(), true).length, `${x},${z} @${hour}`).toBeGreaterThan(0);
        expect(rankPlaces(all, x, z, 600, 2600, hour, () => rng.next(), true).length, `${x},${z} @${hour}`).toBe(8);
      }
    }
  });
});
