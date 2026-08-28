/* 一口气跑完所有检查：node tools/test.js */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
let bad = 0;
for (const f of ['playtest.js', 'fuzz.js']) {
  console.log('\n──── ' + f + ' ────');
  try { execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' }); }
  catch (e) { bad++; }
}
process.exit(bad ? 1 : 0);
