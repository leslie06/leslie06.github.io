/** 赛道纪录史 (online/Leaderboard.ts, stats/ `/rec`): each time a course's record falls, who, how long, how it was run. */
export const REC_EN = {
  'rec.news': '{name} set a new record on {course}: {time}',
  'rec.mine': 'Course record! {course} {time} (beat {name}\'s {prev})', 'rec.first': 'Course record! {course} {time}: the first on the books',
  'rec.friend': '{name} set the course record on {course}: {time}', 'rec.cardMark': ' · 🏆 record {time} from the gate',
  'rec.title': 'Record history', 'rec.solo': 'time trial', 'rec.room': 'race of {n}', 'rec.none': 'Nobody has set a record here yet: a time trial or a room race sets the first',
  'rec.count': 'The record has fallen {n} times · times run from the start gate', 'rec.loading': 'Loading the records…',
  'rec.opt': 'record {time} {name}', 'rec.optNone': 'no record yet', 'rec.raceRec': 'Record to beat: {time} ({name})',
} as const;

export const REC_ZH: Record<keyof typeof REC_EN, string> = {
  'rec.news': '{name} 刷新了「{course}」的全服纪录：{time}',
  'rec.mine': '全服纪录！{course} {time}（破了 {name} 的 {prev}）', 'rec.first': '全服纪录！{course} {time}：这条赛道的第一个纪录',
  'rec.friend': '{name} 破了「{course}」的全服纪录：{time}', 'rec.cardMark': ' · 🏆 全服纪录（过起点门起 {time}）',
  'rec.title': '纪录史', 'rec.solo': '单人计时赛', 'rec.room': '{n} 人联机赛', 'rec.none': '这条赛道还没有纪录：跑一次计时赛或者联机赛就是第一个',
  'rec.count': '纪录被刷新过 {n} 次 · 用时从起点门算到终点', 'rec.loading': '正在读纪录……',
  'rec.opt': '纪录 {time} {name}', 'rec.optNone': '还没有纪录', 'rec.raceRec': '要破的纪录：{time}（{name}）',
};
