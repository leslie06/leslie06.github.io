// English for Chinese names the way Beijing's bilingual signs write them: the proper name in pinyin run
// together, the generic part after it (建国门外大街 Jianguomenwai Dajie, 朝阳公园桥 Chaoyanggongyuan
// Qiao), ring roads in English (东四环中路 E 4th Ring Rd M). OSM's own name:en is too patchy for that
// (a third of the names, and 双新桥's is the ring road's). Shared by build.mjs and places.mjs.
import { pinyin } from 'pinyin-pro';

const GENERIC = [['高速公路', 'Expwy'], ['快速路', 'Expwy'], ['大街', 'Dajie'], ['胡同', 'Hutong'], ['辅路', 'Fulu'], ['大道', 'Dadao'],
  ['北路', 'Beilu'], ['南路', 'Nanlu'], ['东路', 'Donglu'], ['西路', 'Xilu'], ['中路', 'Zhonglu'], ['北街', 'Beijie'], ['南街', 'Nanjie'],
  ['东街', 'Dongjie'], ['西街', 'Xijie'], ['中街', 'Zhongjie'], ['路', 'Lu'], ['街', 'Jie'], ['巷', 'Xiang'], ['桥', 'Qiao'], ['里', 'Li']];
/** Places: the generic part in English (朝阳公园 Chaoyang Park, 北京站 Beijing Railway Station is OSM's). */
const PLACE = [['公园', 'Park'], ['医院', 'Hospital'], ['大学', 'University'], ['中学', 'Middle School'], ['小学', 'Primary School'],
  ['学校', 'School'], ['博物馆', 'Museum'], ['剧院', 'Theatre'], ['大剧院', 'Grand Theatre'], ['图书馆', 'Library'], ['体育馆', 'Gymnasium'],
  ['体育场', 'Stadium'], ['购物中心', 'Mall'], ['商场', 'Mall'], ['大厦', 'Tower'], ['中心', 'Center'], ['酒店', 'Hotel'], ['饭店', 'Hotel'],
  ['宾馆', 'Hotel'], ['派出所', 'Police Station'], ['小区', 'Residence'], ['社区', 'Community'], ['站', 'Station']];
const RING_N = { 二: '2nd', 三: '3rd', 四: '4th', 五: '5th' }, SIDE = { 东: 'E', 西: 'W', 南: 'S', 北: 'N', 中: 'M' };

function spell(proper) {
  const syl = pinyin(proper, { toneType: 'none', type: 'array' });
  const word = syl.map((q, i) => (i && /^[aoe]/.test(q) ? "'" + q : q)).join('');
  return word[0].toUpperCase() + word.slice(1);
}

/** A road's or an interchange's English, '' when the name is not all Chinese. */
export function pinyinOf(name) {
  const ring = name.match(/^([东西南北])([二三四五])环([东西南北中])?路?(辅路)?$/);
  if (ring) return `${SIDE[ring[1]]} ${RING_N[ring[2]]} Ring Rd${ring[3] ? ' ' + SIDE[ring[3]] : ''}${ring[4] ? ' Fulu' : ''}`;
  if (!/^[一-鿿]+$/.test(name)) return '';
  let proper = name, generic = '';
  for (const [zh, en] of GENERIC) if (name.endsWith(zh) && name.length > zh.length) { proper = name.slice(0, -zh.length); generic = en; break; }
  return spell(proper) + (generic ? ' ' + generic : '');
}

/** A place's English: its generic part translated, the rest in pinyin ('' when not all Chinese). */
export function placeEn(name) {
  if (!/^[一-鿿]+$/.test(name)) return '';
  for (const [zh, en] of PLACE) if (name.endsWith(zh) && name.length > zh.length) return spell(name.slice(0, -zh.length)) + ' ' + en;
  return spell(name);
}
