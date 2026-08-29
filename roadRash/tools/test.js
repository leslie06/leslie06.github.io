/* 一口气跑完所有检查：node tools/test.js */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
let bad = 0;
for (const f of ['fuzz.js', 'playtest.js']) {
  console.log('\n──── ' + f + ' ────');
  try { execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' }); }
  catch (e) { bad++; }
}
console.log('\n（想看画面：node tools/shot.js，会把五条街各画一帧存进 shots/）');
process.exit(bad ? 1 : 0);
