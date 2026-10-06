/**
 * The lines people say out loud, for scripts/voice/render.py to record (2026-10-05, 「说话不自然，一听就是
 * 机器人说的」): every NPC line (core/i18n/npc.ts) and the passers-by's shouts, less what is only ever shown
 * on the HUD (objectives, options, names, toasts with money). A line with a parameter is recorded with the
 * parameter said generically (`SPOKEN`: 「去{place}」 -> 「去这个地方」); the subtitle keeps the real name.
 *   npx tsx scripts/voice/lines.mts > .cache/voice/lines.json
 */
import { STRINGS, type TKey } from '../../src/core/I18n';
import { NPC_ZH } from '../../src/core/i18n/npc';

const HUD = /(^|\.)(obj|opt[A-Za-z]*|who|name|role|mapLabel|hearts|unlock|hint[A-Za-z]*|banner|talk|j|wins|met|pickBag|bagGot|legit)(\.|\d|$)|^(map|garage|perk|pax\.obj|life\.(buy|tip|game))\b/;
const TOAST = /[+-]¥|¥\{|^F |·|：\+|体力 \+/;
/** HUD text that reads like speech. */
const SHOWN = /^life\.(dir|thing|noCash|taichi\.done)|^event\.black(?!Shout)|^con\.warning|^npc\.\w+(Late|Gone|Fled|Fail)$/;

/** What a line with a parameter is recorded as. Lines with parameters not listed here are not recorded. */
const SPOKEN: Record<string, string> = {
  'pax.normal.board1': '师傅，麻烦您，去这个地方。',
  'pax.normal.board2': '师傅，赶时间，快点儿！',
  'pax.normal.board3': '不着急，您开稳当点儿。',
  'pax.rush.board': '师傅，去火车站！火车还有二十分钟就开了！',
  'pax.queasy.board': '师傅……我晕车，您开稳点儿。',
  'pax.chatty.board': '走着！小伙子，开车几年啦？',
  'pax.chatty.lm1': '瞧见没，那儿！我小时候常来这儿。',
  'pax.chatty.lm2': '这一片儿啊，当年可不是这样。',
  'pax.chatty.lm3': '到这儿了，给你讲讲……算了，你看路。',
  'pax.streamer.board': '家人们，今天坐个出租车出发啦！',
  'pax.drunk.board': '去……去那个……我没喝多……',
  'pax.mystery.board': '别问。往前开。',
  'pax.mystery.lost': '干净了。走吧。',
  'life.chess.hint': '听说那边儿有个好东西，去瞧瞧？',
  'npc.daijia.ask': '喝多了……帮我把车开回家，给你钱，干不干？',
  'npc.foreigner.ask': 'Excuse me……请问，您能带我去这个地方吗？',
  'npc.foreigner.wow': 'Wow！那是什么？Amazing！',
};

const keys = new Set<string>([...Object.keys(NPC_ZH), ...Object.keys(STRINGS.zh).filter((k) => k.startsWith('shout.'))]);
const out: { key: string; text: string }[] = [];
for (const key of [...keys].sort()) {
  const s = STRINGS.zh[key as TKey];
  if (!s || HUD.test(key) || SHOWN.test(key) || TOAST.test(s)) continue;
  if (!/[\p{L}\p{N}]/u.test(s)) continue;   // 「……」: nothing to say
  if (/\{/.test(s)) { if (SPOKEN[key]) out.push({ key, text: SPOKEN[key] }); continue; }
  out.push({ key, text: s });
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
