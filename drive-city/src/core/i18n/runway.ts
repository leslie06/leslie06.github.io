/** 首都机场第三批（2026-11-16）：闯空侧的通缉（police/）、跑道极速（trials/Runway.ts）和它的排行榜、纪录史（online/）。 */
export const RUNWAY_EN = {
  'wanted.airside': 'Airport restricted area breached: airport police on their way',
  'wanted.runway': 'On an active runway: helicopter up',
  'rwy.name': 'RUNWAY TOP SPEED',
  'rwy.go': 'Runway top speed · {rwy} · floor it!',
  'rwy.sub': 'This run {max} · best {best}',
  'rwy.subNew': 'This run {max} · no best yet',
  'rwy.done': 'Runway {rwy} · top {kmh} km/h · best {best} km/h',
  'rwy.newBest': 'new best!',
  'lb.runway': 'Runway top speed · {rwy}',
  'rec.rwySolo': 'runway top speed',
  'rec.rwyNone': 'Nobody has set a record here yet: drive onto the runway and floor it',
  'rec.rwyCount': 'The record has fallen {n} times · the top speed between driving onto the runway and leaving it',
} as const;

export const RUNWAY_ZH: Record<keyof typeof RUNWAY_EN, string> = {
  'wanted.airside': '闯入机场控制区：机场公安出动',
  'wanted.runway': '闯上跑道：直升机升空',
  'rwy.name': '跑道极速',
  'rwy.go': '跑道极速 · {rwy} · 踩到底！',
  'rwy.sub': '本趟最高 {max} · 最好 {best}',
  'rwy.subNew': '本趟最高 {max} · 还没有成绩',
  'rwy.done': '跑道 {rwy} · 最高 {kmh} km/h · 最好 {best} km/h',
  'rwy.newBest': '新纪录！',
  'lb.runway': '跑道极速 · {rwy}',
  'rec.rwySolo': '跑道极速',
  'rec.rwyNone': '这条跑道还没有纪录：开上跑道踩到底就是第一个',
  'rec.rwyCount': '纪录被刷新过 {n} 次 · 开上跑道到离开跑道之间的最高时速',
};
