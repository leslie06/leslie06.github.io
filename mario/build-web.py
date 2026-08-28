#!/usr/bin/env python3
"""从 mario.html 提取游戏脚本，生成可发布为在线页面的 mario-web.html。
Artifact 会自带 <!doctype>/<head>/<body>，因此这里只输出页面内容本身。"""
import re, pathlib

src = pathlib.Path('mario.html').read_text(encoding='utf-8')
m = re.search(r'<script>\n(.*)\n</script>', src, re.S)
assert m, '未找到游戏脚本'
game_js = m.group(1)

PAGE = '''<title>超级酷跑兄弟</title>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=ZCOOL+KuaiLe&display=swap">
<style>
  /* 街机机身：单一深色世界，所有颜色显式声明，不依赖宿主主题 */
  :root{
    --ground:#0b0d18; --panel:#141829; --screen:#05060c;
    --sky:#5c94fc; --coin:#ffdb4d; --brick:#c85a28;
    --text:#e8ebf7; --muted:#7d84ad; --dim:#5f668c;
    --line:rgba(124,132,173,.22);
    --arcade:"Press Start 2P","Courier New",monospace;
    --han:"ZCOOL KuaiLe","PingFang SC","Microsoft YaHei",sans-serif;
    --ui:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
  html,body{height:100%;margin:0;}
  body{background:var(--ground);color:var(--text);font-family:var(--ui);
    overflow:hidden;touch-action:none;overscroll-behavior:none;
    display:flex;align-items:center;justify-content:center;}

  #cab{width:100%;height:100%;padding:16px;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:16px;}

  #bar{width:min(1080px,100%);display:flex;align-items:baseline;
    justify-content:space-between;gap:20px;}
  #bar .mark{margin:0;font-family:var(--han);font-weight:400;
    font-size:clamp(21px,3vw,30px);letter-spacing:2px;
    color:var(--coin);text-shadow:3px 3px 0 var(--brick);}
  #bar .eyebrow{margin:0;font-family:var(--arcade);font-size:9px;line-height:1.9;
    letter-spacing:1.4px;color:var(--muted);text-align:right;}
  #bar .eyebrow i{font-style:normal;color:var(--sky);}

  #wrap{position:relative;padding:12px;background:var(--screen);border-radius:12px;
    box-shadow:inset 0 0 0 2px rgba(92,148,252,.22),
               inset 0 0 44px rgba(92,148,252,.10),
               0 26px 70px rgba(0,0,0,.75);}
  #wrap::after{content:"";position:absolute;inset:12px;border-radius:3px;pointer-events:none;
    background:repeating-linear-gradient(to bottom,
      rgba(3,5,12,.17) 0 1px, rgba(3,5,12,0) 1px 3px);}
  canvas{display:block;background:var(--sky);border-radius:3px;image-rendering:pixelated;}

  #legend{width:min(1080px,100%);display:flex;flex-wrap:wrap;justify-content:center;
    align-items:center;gap:9px 22px;color:var(--muted);font-size:13px;}
  #legend .grp{display:inline-flex;align-items:center;gap:7px;}
  #legend .cap{font-family:var(--arcade);font-size:9px;font-weight:400;line-height:1;
    color:#cfd6f5;background:var(--panel);border:1px solid var(--line);
    border-bottom-width:3px;border-radius:5px;padding:6px 8px;}
  #legend .hint{color:var(--dim);}

  #rotate,#pad,#pausebtn{display:none;}
  #pad{position:fixed;left:0;right:0;bottom:0;
    padding:0 20px calc(14px + env(safe-area-inset-bottom));
    justify-content:space-between;align-items:flex-end;
    user-select:none;-webkit-user-select:none;pointer-events:none;z-index:5;}
  #pad .g{display:flex;gap:14px;align-items:flex-end;}
  #pad b,#pausebtn{border-radius:50%;background:rgba(255,255,255,.16);
    border:2px solid rgba(255,255,255,.34);color:#fff;font-weight:bold;
    align-items:center;justify-content:center;}
  #pad b{width:74px;height:74px;display:flex;font-size:24px;}
  #pad b.big{width:92px;height:92px;font-size:30px;}
  #pad b.on{background:rgba(255,255,255,.44);transform:scale(.94);}
  #pausebtn{position:fixed;top:calc(8px + env(safe-area-inset-top));right:10px;
    width:46px;height:46px;font-size:15px;letter-spacing:1px;z-index:6;}

  @media (max-width:430px){
    #pad{padding-left:12px;padding-right:12px;}
    #pad .g{gap:10px;}
    #pad b{width:66px;height:66px;font-size:22px;}
    #pad b.big{width:82px;height:82px;font-size:26px;}
  }
  @media (pointer:coarse){
    #bar,#legend{display:none;}
    #pad{display:flex;}
    #pausebtn{display:flex;}
    #cab{padding:0;gap:0;}
    #wrap{padding:0;border-radius:0;box-shadow:none;}
    #wrap::after{inset:0;border-radius:0;}
    canvas{border-radius:0;}
  }
  @media (pointer:coarse) and (orientation:portrait){
    #cab{justify-content:flex-start;padding-top:14vh;}
    #rotate{display:block;margin:18px 0 0;font-size:13px;color:var(--dim);letter-spacing:1px;}
  }
  @media (pointer:coarse) and (orientation:landscape){
    #pad{padding-bottom:calc(6px + env(safe-area-inset-bottom));}
    #pad b{opacity:.82;}
  }
</style>

<div id="cab">
  <header id="bar">
    <h1 class="mark">超级酷跑兄弟</h1>
    <p class="eyebrow">SUPER RUNNER BROS<br><i>3 STAGES</i> &middot; 8-BIT PLATFORMER</p>
  </header>
  <div id="wrap"><canvas id="game" width="800" height="480"></canvas></div>
  <p id="rotate">↻ 横屏可获得更大画面</p>
  <footer id="legend">
    <span class="grp"><b class="cap">&larr;</b><b class="cap">&rarr;</b>移动</span>
    <span class="grp"><b class="cap">SPACE</b>跳跃 · 长按更高</span>
    <span class="grp"><b class="cap">SHIFT</b>加速 · 火球</span>
    <span class="grp"><b class="cap">P</b>暂停</span>
    <span class="grp"><b class="cap">R</b>重来</span>
    <span class="grp hint">先点一下画面，键盘才会生效</span>
  </footer>
</div>
<div id="pad">
  <div class="g"><b data-k="left">&#9664;</b><b data-k="right">&#9654;</b></div>
  <div class="g"><b data-k="run">B</b><b data-k="jump" class="big">A</b></div>
</div>
<b id="pausebtn">II</b>

<script>
__GAME__
</script>
'''

out = PAGE.replace('__GAME__', game_js)
pathlib.Path('mario-web.html').write_text(out, encoding='utf-8')
print('mario-web.html 已生成:', len(out), '字节  (Artifact 片段, 用 Google Fonts)')

# ---- 独立版：完整 HTML 文档 + 零外部请求，可离线 / 微信 / 任意静态托管 ----
alone = out
# 去掉 Google Fonts，改用系统字体栈
alone = re.sub(r'<link rel="preconnect"[^>]*>\n', '', alone)
alone = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>\n', '', alone)
alone = alone.replace('--arcade:"Press Start 2P","Courier New",monospace;',
                      '--arcade:"Courier New",Menlo,Consolas,monospace;')
alone = alone.replace('--han:"ZCOOL KuaiLe","PingFang SC","Microsoft YaHei",sans-serif;',
                      '--han:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;')
# 系统中文字体没有圆体的活泼感，字标补足字重与字距
alone = alone.replace('font-size:clamp(21px,3vw,30px);letter-spacing:2px;',
                      'font-size:clamp(21px,3vw,30px);letter-spacing:4px;font-weight:800;')
alone = alone.replace('#bar .mark{margin:0;font-family:var(--han);font-weight:400;',
                      '#bar .mark{margin:0;font-family:var(--han);')
alone = alone.replace('#legend .cap{font-family:var(--arcade);font-size:9px;font-weight:400;',
                      '#legend .cap{font-family:var(--arcade);font-size:11px;font-weight:700;')
alone = alone.replace('#bar .eyebrow{margin:0;font-family:var(--arcade);font-size:9px;',
                      '#bar .eyebrow{margin:0;font-family:var(--arcade);font-size:11px;font-weight:700;')
head_lines, rest = alone.split('\n', 2)[:2], alone.split('\n', 2)[2]
assert head_lines[0].startswith('<title>') and 'viewport' in head_lines[1], '头部结构与预期不符'
doc = ('<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
       + '\n'.join(head_lines) + '\n</head>\n<body>\n' + rest + '\n</body>\n</html>\n')
pathlib.Path('index.html').write_text(doc, encoding='utf-8')
print('index.html 已生成:', len(doc), '字节  (完整文档, 零外部请求, 静态托管入口)')
