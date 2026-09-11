/**
 * The one stylesheet for ui/. Injected once by Hud.
 *
 * Layout is authored against the 1080p reference numbers in ref/notes.md and re-derived from `vh`
 * so it holds at 720p and 4K: 24px safe margin, 220px minimap at (24,24), ~38px ammo numerals,
 * 150x6 health bar, 24px killfeed glyphs, 9px crosshair arms. Type is condensed all-caps with
 * ~1px letter-spacing (never the 0.3em tracking that made this read like a web page), white at
 * 90%, secondary at 55-60%, and dark plates only behind the minimap and killfeed.
 *
 * GOLD BUDGET. Exactly two things in the live HUD are allowed to be gold: the objective line and
 * the reload prompt. Everything the critic listed as "gold-everything" - compass heading, wave
 * subtitle, score popups, killfeed skull, low-ammo count, the crosshair hit flash - is white at a
 * chosen opacity, and separates by size, weight and opacity instead of hue. The only other colour
 * in the HUD is semantic and rare: green = you, red = hostile / out of ammo / damage.
 * Animations touch transform + opacity only so the compositor does the work.
 */
import { cssVars } from './theme';

/** Fine luminance noise for the menu plates. Inline data URI — no network at runtime. */
const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")`;

export const STYLES = /* css */ `
#ui{${cssVars()};position:fixed;inset:0;pointer-events:none;overflow:hidden;
  font-family:var(--font-display);font-stretch:condensed;font-weight:500;color:var(--c-white);
  font-size:clamp(11px,1.45vh,32px);line-height:1.2;
  --m:clamp(16px,2.24vh,48px);
  --r:clamp(6px,.75vh,16px);
  -webkit-font-smoothing:antialiased;user-select:none;}
#ui *{box-sizing:border-box}
#ui.shot *{transition:none!important}
#ui svg{display:block;overflow:visible}
#ui .u{text-transform:uppercase}

/* ------------------------------------------------------------------ layers */
#hud{position:absolute;inset:0;opacity:1;transition:opacity .18s;color:var(--c-hud)}
#hud.hidden{opacity:0}
#hud>*{text-shadow:var(--text-shadow)}
#screens{position:absolute;inset:0}
.ovl{position:absolute;inset:0;opacity:var(--o,0)}
.ovl.vig{background:radial-gradient(ellipse at center,rgba(150,0,0,0) 40%,rgba(150,0,0,.6) 100%)}
.ovl.vig.beat{animation:vigbeat .9s ease-in-out infinite}
.ovl.sprintf{box-shadow:inset 0 0 clamp(60px,9vw,220px) rgba(0,0,0,.42);transition:opacity .28s}
.ovl.dmgflash{background:radial-gradient(ellipse at center,rgba(255,40,30,0) 28%,rgba(255,40,30,.42) 100%)}

/* --------------------------------------------------------------- crosshair
   Hipfire: 4 arms, ~9px long, 1.7px thick, gap driven by the weapon's spread. */
.xh{position:absolute;left:50%;top:50%;width:0;height:0;--gap:12px;--len:clamp(6px,.83vh,17px);--th:clamp(1.2px,.155vh,3px);opacity:var(--o,1);transition:opacity .1s;filter:drop-shadow(0 1px 1px rgba(0,0,0,.85))}
.xh .l{position:absolute;background:#fff;transition:opacity .1s,background-color .05s}
.xh .t{left:calc(var(--th)/-2);top:calc(-1*(var(--gap) + var(--len)));width:var(--th);height:var(--len)}
.xh .b{left:calc(var(--th)/-2);top:var(--gap);width:var(--th);height:var(--len)}
.xh .lf{top:calc(var(--th)/-2);left:calc(-1*(var(--gap) + var(--len)));width:var(--len);height:var(--th)}
.xh .rt{top:calc(var(--th)/-2);left:var(--gap);width:var(--len);height:var(--th)}
.xh .dot{position:absolute;left:calc(var(--th)/-2);top:calc(var(--th)/-2);width:var(--th);height:var(--th);background:#fff;opacity:0;transition:opacity .1s}
.xh .ring{position:absolute;left:calc(-1*var(--gap));top:calc(-1*var(--gap));width:calc(var(--gap)*2);height:calc(var(--gap)*2);border:var(--th) solid #fff;border-radius:50%;opacity:0;transition:opacity .1s}
/* Hit flash is a white bloom, not a colour change - the hitmarker X is the coloured cue. */
.xh.hit .l,.xh.hit .ring{background:#fff;border-color:#fff;box-shadow:0 0 4px rgba(255,255,255,.85)}
.xh.sprint .l,.xh.sprint .ring{opacity:0}.xh.sprint .dot{opacity:.75}
.xh.ads,.xh.k-sniper{opacity:0}
.xh.k-shotgun .l{opacity:0}.xh.k-shotgun .ring{opacity:1}
.xh.k-shotgun.sprint .ring{opacity:0}

/* -------------------------------------------------------------- hitmarker */
.hm{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;--hg:clamp(3px,.4vh,8px);--hl:clamp(5px,.72vh,15px);--hw:clamp(1.2px,.17vh,3px)}
.hm i{position:absolute;left:calc(var(--hw)/-2);top:calc(-1*(var(--hg) + var(--hl)));width:var(--hw);height:var(--hl);background:#fff;transform-origin:50% calc(100% + var(--hg));filter:drop-shadow(0 1px 1px rgba(0,0,0,.8))}
.hm i:nth-child(1){transform:rotate(45deg)}.hm i:nth-child(2){transform:rotate(135deg)}.hm i:nth-child(3){transform:rotate(225deg)}.hm i:nth-child(4){transform:rotate(315deg)}
/* Kill = red, headshot = red and longer. Gold here put an amber X in the dead centre of every
   combat frame, which is most of what "everything is gold" was pointing at. */
.hm.kill i,.hm.hs i{background:var(--c-kill)}
.hm.hs{--hl:clamp(7px,1vh,21px)}

/* ------------------------------------------------------ damage indicators */
.di{position:absolute;left:50%;top:50%;--ds:clamp(220px,36vh,700px);width:var(--ds);height:var(--ds);margin:calc(var(--ds)/-2) 0 0 calc(var(--ds)/-2);opacity:0;will-change:transform,opacity}
.di svg{width:100%;height:100%}

/* -----------------------------------------------------------------
   health — thin 150x6 bar at 1080p with the number beside it (BL) */
.hp{position:absolute;left:var(--m);bottom:var(--m);display:flex;align-items:center;gap:.75em}
.hp .bar{position:relative;width:clamp(110px,13.9vh,300px);height:clamp(4px,.56vh,12px);background:rgba(0,0,0,.45);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
.hp .f,.hp .ch{position:absolute;left:1px;top:1px;bottom:1px;width:var(--f,100%)}
.hp .ch{background:rgba(255,255,255,.3);transition:none}
.hp .f{background:var(--c-hud)}
.hp .rd{display:flex;align-items:baseline;gap:.35em}
.hp .num{font-size:1.35em;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.hp .lbl{font-size:.72em;letter-spacing:1px;opacity:.5;font-weight:600}
.hp.low .f{background:var(--c-danger)}
.hp.low .num{color:var(--c-danger);animation:heartbeat .9s ease-in-out infinite;transform-origin:left center}

/* ------------------------------------------------------------------- ammo
   weapon glyph + ~38px mag count + ~19px reserve, meta line, equipment slot */
.ammo{position:absolute;right:var(--m);bottom:var(--m);display:flex;flex-direction:column;align-items:flex-end}
.ammo .rl{font-size:.95em;letter-spacing:1.5px;font-weight:700;opacity:0;height:1.2em;margin-bottom:.2em;color:var(--c-gold)}
.ammo.rlp .rl{animation:pulse .85s ease-in-out infinite}
.ammo.rlg .rl{color:var(--c-hud);opacity:.9;animation:none}
.ammo .row{display:flex;align-items:baseline;gap:.42em;line-height:.92}
.ammo .wi{width:2.9em;height:1.58em;opacity:.7;align-self:center;margin-right:.2em;margin-bottom:.1em}
.ammo .mag{font-size:2.42em;font-weight:700;font-variant-numeric:tabular-nums}
.ammo .res{font-size:1.2em;font-weight:600;opacity:.55;font-variant-numeric:tabular-nums}
.ammo .meta{display:flex;align-items:center;gap:.55em;margin-top:.42em;font-size:.82em;letter-spacing:1px;font-weight:600;opacity:.6}
.ammo .meta .mode{display:flex;align-items:center;gap:.3em}
.ammo .meta .mode svg{width:.85em;height:.85em}
.ammo .eq{display:flex;align-items:center;gap:.4em;margin-top:.55em;font-size:.9em;opacity:.75;font-weight:600}
.ammo .eq .gi{width:1.35em;height:1.35em;opacity:.8}
.ammo .eq .c{font-variant-numeric:tabular-nums}
.ammo .eq .key{font-size:.7em;font-weight:700;letter-spacing:.5px;border:1px solid rgba(255,255,255,.3);padding:.05em .35em;opacity:.7;margin-left:.15em}
.ammo.noeq .eq{display:none}
/* Low ammo reads as a flashing white count next to the gold RELOAD prompt; only *empty* is red. */
.ammo.low .mag{color:var(--c-white);animation:ammoflash .55s steps(2,end) infinite}
.ammo.empty .mag{color:var(--c-danger)}

/* ------------------------------------------------------------ slots popup
   Two slots only: the weapon you just drew, large, and the one you'd swap to. */
.slots{position:absolute;right:var(--m);bottom:calc(var(--m) + 8.6em);display:flex;flex-direction:column;align-items:flex-end;gap:.3em;opacity:0}
.slots .s{display:flex;align-items:center;gap:.6em;font-size:.95em;letter-spacing:1px;font-weight:600;opacity:.4}
.slots .s svg{width:2.4em;height:1.3em}
.slots .s .n{font-size:.72em;opacity:.6;font-family:var(--font-mono);font-stretch:normal}
.slots .s.cur{opacity:1;font-size:1.12em}
.slots .s.cur svg{width:2.9em;height:1.58em}

/* ---------------------------------------------------------------- killfeed
   Team green / hostile red-orange, 24px line glyph, 40% black plate. */
.kf{position:absolute;right:var(--m);top:var(--m);display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.kf .row{display:flex;align-items:center;gap:.5em;padding:.2em .6em;background:var(--c-panel);font-size:.9em;letter-spacing:.6px;font-weight:600;white-space:nowrap;will-change:transform,opacity}
.kf .nm.ally{color:var(--c-ally)}
.kf .nm.en{color:var(--c-enemy)}
.kf .w{width:2.85em;height:1.55em;color:rgba(255,255,255,.85);opacity:.9}
.kf .sk{width:1.05em;height:1.05em;color:rgba(255,255,255,.8)}

/* ----------------------------------------------------------- score popups
   Right of the crosshair, 0.6s, at most two. */
.score{position:absolute;left:calc(50% + 3.4em);top:calc(50% - .35em);display:flex;flex-direction:column;align-items:flex-start;gap:.2em}
.sp{display:flex;align-items:baseline;gap:.4em;white-space:nowrap;opacity:0;will-change:transform,opacity}
.sp .pts{font-size:1.3em;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.sp .lbl{font-size:.78em;letter-spacing:1px;font-weight:600;opacity:.6}
/* No hue here: a headshot is a bigger number, a streak is a smaller dimmer one. */
.sp.hs .pts{font-size:1.42em}
.sp.streak .pts{font-size:1.08em;opacity:.8}
.sp.streak .lbl{opacity:.5}

/* ---------------------------------------------------------------- compass
   Ruler of 1px ticks + small labels, gold heading between hairlines (ref_10). */
/* Width in em so the visible arc (~92°) is identical at 720p, 1080p and 4K. */
.compass{position:absolute;left:50%;top:calc(var(--m)*.72);width:min(48em,44vw);transform:translateX(-50%);--dpp:.52em}
.compass .win{position:relative;height:2.1em;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 13%,#000 87%,transparent);mask-image:linear-gradient(90deg,transparent,#000 13%,#000 87%,transparent)}
.compass .strip{position:absolute;left:50%;top:0;height:100%;width:0;transform:translateX(var(--x,0em));will-change:transform}
.compass .tk{position:absolute;bottom:.3em;width:1px;height:.3em;background:currentColor;opacity:.45}
.compass .tk.mj{height:.52em;opacity:.7}
/* nowrap: the strip is zero-width, so a two-character CJK label (东北) would otherwise stack vertically. */
.compass .lb{position:absolute;top:.28em;transform:translateX(-50%);line-height:1;white-space:nowrap}
.compass .lb span{display:block;font-size:.76em;font-weight:600;letter-spacing:.5px;opacity:.5}
.compass .lb.cd span{font-size:.9em;font-weight:700;letter-spacing:1px;opacity:.82}
.compass .em{position:absolute;top:1.02em;width:.4em;height:.4em;background:var(--c-enemy);transform:translateX(-50%) rotate(45deg);opacity:0}
.compass .hw{position:absolute;left:50%;top:.05em;transform:translateX(-50%);display:flex;align-items:center;gap:.45em}
.compass .hw .b{width:1px;height:1.2em;background:currentColor;opacity:.4}
.compass .hdg{font-size:1.2em;font-weight:700;line-height:1;color:var(--c-white);letter-spacing:.5px;font-variant-numeric:tabular-nums}

/* --------------------------------------------------------------- objective
   Announced under the compass, then demoted to one dim gold line after 3s. */
.obj{position:absolute;left:50%;top:calc(var(--m)*.72 + 2.45em);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.12em;white-space:nowrap;transition:opacity .6s}
.obj .t{font-size:.95em;letter-spacing:1.5px;font-weight:600}
.obj .c{display:flex;align-items:baseline;gap:.3em;font-size:.85em;letter-spacing:1px;font-weight:600;color:var(--c-gold)}
.obj .n{font-weight:700;font-variant-numeric:tabular-nums}
/* The count phrase is split around the number; English has no prefix, Chinese no suffix. */
.obj .tl:empty{display:none}
.obj.settled{flex-direction:row;align-items:baseline;gap:.5em;opacity:.55;color:var(--c-gold)}
.obj.settled .t{font-size:.82em;letter-spacing:1px}
.obj.settled .c{font-size:.82em}
.obj.settled .c:before{content:'·';opacity:.7;margin-right:.2em}

/* ----------------------------------------------------------------- minimap
   220x220 at 1080p, 8px radius, 40% black plate. */
.mm{position:absolute;left:var(--m);top:var(--m);width:clamp(150px,20.37vh,440px)}
.mm .map{position:relative;width:100%;aspect-ratio:1;border-radius:var(--r);overflow:hidden;background:rgba(0,0,0,.40)}
.mm .rim{position:absolute;inset:0;border-radius:var(--r);box-shadow:inset 0 0 0 1px rgba(255,255,255,.15),inset 0 0 20px rgba(0,0,0,.45)}
.mm canvas{display:block;width:100%;height:100%}
.mm .mmst{margin-top:.5em;display:flex;gap:.95em;white-space:nowrap;align-items:baseline}
.mm .mmst .s{display:flex;align-items:baseline;gap:.35em}
.mm .mmst .l{font-size:.72em;letter-spacing:1px;opacity:.48;font-weight:600}
.mm .mmst .v{font-size:1.02em;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;opacity:.95}

/* ------------------------------------------------------------ wave banner
   High at 19% so it never shares space with the reticle; 1.2s then fades. */
.wave{position:absolute;left:0;right:0;top:17%;text-align:center;opacity:0;pointer-events:none}
.wave .ln{width:0;height:1px;margin:0 auto .6em;background:currentColor;opacity:.75}
.wave .big{font-size:3.3em;font-weight:700;letter-spacing:.08em;line-height:1;will-change:transform}
.wave .sub{font-size:.9em;letter-spacing:2px;margin-top:.55em;font-weight:600;color:var(--c-hud);opacity:.62}

/* ----------------------------------------------------- message + prompts */
.msg{position:absolute;left:50%;bottom:calc(var(--m) + 6.6em);transform:translateX(-50%);font-size:1.05em;letter-spacing:1.5px;font-weight:600;opacity:0;white-space:nowrap}
/* Interaction hint, lower centre. Filled light keycap + caps action, as in ref_01's "TAB RUCKSACK". */
.prompt{position:absolute;left:50%;top:60%;transform:translateX(-50%);display:flex;align-items:center;gap:.6em;opacity:0;white-space:nowrap}
.prompt .key{background:rgba(240,243,248,.92);color:#0b0d11;padding:.14em .5em;font-weight:700;font-size:.86em;line-height:1.15;letter-spacing:1px;text-shadow:none;min-width:1.7em;text-align:center}
.prompt .txt{font-size:1em;letter-spacing:1.5px;font-weight:600}
.prompt.nokey .key{display:none}

/* ----------------------------------------------------------------
   screens — the live scene stays visible: bg blurs but keeps colour,
   bloom screens the bright end back in, vig darkens the type side. */
/* No stacking context here: .bg/.bloom use backdrop-filter, which only reaches the scene
   while #screens stays out of the backdrop root (isolation/filter/opacity<1 would sever it). */
.screen{position:absolute;inset:0;opacity:0;pointer-events:none;transition:opacity .22s;cursor:default}
.screen.show{opacity:1;pointer-events:auto}
/* NOTE: nothing under .screen may use mix-blend-mode. A blending descendant isolates the group,
   which turns .screen into a backdrop root and silently kills .bg's backdrop-filter (the blur
   simply stops happening). The sun bloom and the grain are therefore painted, not blended. */
.screen .bg{position:absolute;inset:-6%;
  -webkit-backdrop-filter:blur(13px) saturate(1.35) contrast(1.08) brightness(.8);backdrop-filter:blur(13px) saturate(1.35) contrast(1.08) brightness(.8);
  animation:drift 38s ease-in-out infinite alternate}
.screen .bloom{position:absolute;inset:0;background:
  radial-gradient(46% 40% at 66% 4%,rgba(255,214,160,.26),rgba(255,196,140,.09) 46%,transparent 74%),
  radial-gradient(90% 60% at 50% 0%,rgba(150,180,225,.10),transparent 70%)}
.screen .vig{position:absolute;inset:0;background:
  linear-gradient(100deg,rgba(4,6,9,.9) 0%,rgba(4,6,9,.76) 30%,rgba(4,6,9,.3) 66%,rgba(4,6,9,.46) 100%),
  radial-gradient(135% 105% at 50% 46%,transparent 32%,rgba(0,0,0,.55) 100%)}
.screen .vig:after{content:'';position:absolute;inset:0;background-image:${NOISE};background-size:160px 160px;opacity:.05}
.screen .edge{position:absolute;left:var(--m);right:var(--m);height:1px;background:var(--c-line)}
.screen .edge.top{top:calc(var(--m) + 1.7em)}.screen .edge.bot{bottom:calc(var(--m) + 1.9em)}
.screen .corner{position:absolute;top:var(--m);left:var(--m);font-size:.8em;letter-spacing:2px;opacity:.65;font-weight:600}
.screen .corner.r{left:auto;right:var(--m);text-align:right}
/* Main menu: the right-hand corner is the 中文 | ENGLISH switch, sized to sit above the top rule. */
.screen .corner .seg .o{font-size:.92em;padding:.2em .8em}
.screen .corner:has(.seg){opacity:.85}
.screen .ver{position:absolute;right:var(--m);bottom:var(--m);font-size:.75em;letter-spacing:1.5px;opacity:.45;font-family:var(--font-mono);font-stretch:normal}
.screen .hint{position:absolute;left:var(--m);bottom:var(--m);font-size:.78em;opacity:.6;display:flex;gap:1.3em}
.screen .hint .hi{display:flex;align-items:center;gap:.4em}
.screen .hint .k{font-weight:700;border:1px solid var(--c-line);padding:.05em .35em;font-size:.92em;letter-spacing:.5px}
.screen .hint .a{letter-spacing:1.5px;opacity:.85;font-weight:600}

.title{position:absolute;left:var(--m);top:17%}
.title .name{font-size:6.6em;font-weight:800;letter-spacing:.015em;line-height:.9;text-shadow:0 2px 3px rgba(0,0,0,.55)}
.title .name i{font-style:normal;display:inline-block;width:.1em;height:.58em;background:var(--c-hit);vertical-align:-.02em;margin-left:.12em}
.title .tag{font-size:.9em;letter-spacing:3px;opacity:.6;margin-top:.85em;font-weight:600}
.title.sm .name{font-size:3.9em}
.title .sub{font-size:.95em;letter-spacing:2px;opacity:.65;margin-top:.55em;font-weight:600}

.menu-list{position:absolute;left:var(--m);top:47%;display:flex;flex-direction:column;gap:.1em;width:clamp(240px,24vw,560px)}
.menu-list.lower{top:44%}
.btn{display:flex;align-items:center;gap:.9em;padding:.5em .9em;font-size:1.35em;letter-spacing:2px;font-weight:600;color:var(--c-dim);cursor:pointer;border-left:2px solid transparent;
  background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0));transition:color .12s,background .12s,border-color .12s,transform .12s;white-space:nowrap}
.btn:hover,.btn.focus{color:var(--c-white);border-left-color:var(--c-white);background:linear-gradient(90deg,rgba(255,255,255,.14),rgba(255,255,255,0) 80%);transform:translateX(.25em)}
.btn.primary{color:var(--c-white)}
.btn.primary:hover{border-left-color:var(--c-hit)}
.btn.danger:hover{border-left-color:var(--c-kill)}
.btn .idx{font-size:.58em;opacity:.4;width:1.6em;letter-spacing:.5px;font-family:var(--font-mono);font-stretch:normal}

/* briefing card (main menu, right side) */
.brief{position:absolute;right:var(--m);bottom:calc(var(--m) + 3.4em);width:clamp(260px,23vw,600px);padding:1.05em 1.25em;background:rgba(6,8,11,.42);border-left:2px solid var(--c-hit)}
.brief .h{font-size:.76em;letter-spacing:2px;opacity:.6;font-weight:600;margin-bottom:.45em}
.brief .t{font-size:1.5em;font-weight:700;letter-spacing:.02em;line-height:1.05}
.brief .d{font-size:.9em;line-height:1.5;opacity:.7;margin-top:.55em;text-transform:none;letter-spacing:.01em;font-weight:500}
.brief .best{display:flex;gap:1.8em;margin-top:.95em;padding-top:.75em;border-top:1px solid var(--c-line)}
.brief .best .st{display:flex;flex-direction:column;gap:.15em}
.brief .best .l{font-size:.7em;letter-spacing:1px;opacity:.55;font-weight:600}
.brief .best .v{font-size:1.4em;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}

/* dead — flat red, 2px drop shadow, 90% opacity. No 2010 outer glow.
   The scrim is deliberately lighter than it looks it should be: stacked on .bg's brightness(.8)
   and the radial, a .9 linear crushed the scene to ~8% and the frame read as a black card. */
.screen.dead .vig{background:
  linear-gradient(180deg,rgba(9,5,5,.74) 0%,rgba(7,5,6,.58) 45%,rgba(9,5,5,.78) 100%),
  radial-gradient(120% 92% at 50% 40%,transparent 20%,rgba(146,16,10,.5) 100%)}
.screen.dead .bloom{opacity:.16}
.kia{position:absolute;left:50%;top:26%;transform:translateX(-50%);text-align:center;white-space:nowrap}
.kia .big{font-size:7.2em;font-weight:800;letter-spacing:.1em;padding-left:.1em;line-height:.92;color:var(--c-kill);opacity:.9;text-shadow:0 2px 0 rgba(0,0,0,.6)}
.kia .sub{font-size:.95em;letter-spacing:3px;padding-left:3px;opacity:.7;margin-top:.6em;font-weight:600}
.kia .ln{width:20em;height:1px;background:var(--c-line);margin:1.3em auto}
.stats{display:flex;justify-content:center;gap:3em}
.stats .st{display:flex;flex-direction:column;align-items:center;gap:.3em;min-width:5em}
.stats .st .l{font-size:.76em;letter-spacing:1.5px;opacity:.55;font-weight:600}
.stats .st .v{font-size:2.4em;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.deploy{position:absolute;left:50%;top:58%;transform:translateX(-50%);text-align:center;display:flex;flex-direction:column;align-items:center;gap:.5em}
.deploy .l{font-size:.85em;letter-spacing:2.5px;opacity:.65;font-weight:600}
.deploy .cd{font-size:4.6em;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;will-change:transform,opacity}
.deploy .btn{font-size:1.4em;border:1px solid rgba(255,255,255,.55);padding:.45em 1.6em;color:var(--c-white);display:none}
.deploy .btn:hover{background:rgba(255,255,255,.14);transform:none}
.deploy.ready .cd{display:none}.deploy.ready .btn{display:flex}

/* settings + controls */
.panel{position:absolute;left:var(--m);top:17%;width:clamp(420px,42vw,1000px);max-height:70%;display:flex;flex-direction:column}
.panel .ph{font-size:3.2em;font-weight:800;letter-spacing:.03em;line-height:1;margin-bottom:.2em}
.panel .ps{font-size:.82em;letter-spacing:2px;opacity:.6;margin-bottom:1.5em;font-weight:600}
.panel .rows{display:flex;flex-direction:column;overflow:auto;padding-right:1em}
/* Plate behind the rows: without it the 1px dividers dissolved into the blurred scene at the
   right-hand end and the list stopped reading as one block. */
.screen.settings .panel .rows,.screen.controls .panel .rows{background:linear-gradient(90deg,rgba(6,8,11,.46),rgba(6,8,11,.22));padding:.15em 1.1em}
.row{display:flex;align-items:center;justify-content:space-between;gap:2em;padding:.7em .4em;border-top:1px solid var(--c-line);font-size:1.02em}
.row:last-child{border-bottom:1px solid var(--c-line)}
.row .lab{letter-spacing:1.5px;font-weight:600;opacity:.9;white-space:nowrap}
.row .lab small{display:block;font-size:.72em;letter-spacing:.3px;opacity:.5;text-transform:none;font-weight:500;margin-top:.15em}
.row .ctl{display:flex;align-items:center;gap:1em;min-width:16em;justify-content:flex-end}
.row .val{font-family:var(--font-mono);font-stretch:normal;font-size:.82em;min-width:3.4em;text-align:right;opacity:.8;font-variant-numeric:tabular-nums}
.row .key{font-family:var(--font-mono);font-stretch:normal;font-size:.85em;border:1px solid var(--c-line);padding:.15em .55em;min-width:2.4em;text-align:center;background:rgba(255,255,255,.05)}
.row .keys{display:flex;gap:.4em}
input[type=range].sl{-webkit-appearance:none;appearance:none;width:12em;height:2px;background:var(--c-line);outline:none;cursor:pointer;margin:0}
input[type=range].sl::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:.7em;height:1.3em;background:var(--c-white);border:0}
input[type=range].sl::-moz-range-thumb{width:.7em;height:1.3em;background:var(--c-white);border:0;border-radius:0}
input[type=range].sl:hover::-webkit-slider-thumb{background:var(--c-hit)}
.seg{display:flex;border:1px solid var(--c-line)}
.seg .o{padding:.3em .85em;font-size:.82em;letter-spacing:1.5px;font-weight:600;cursor:pointer;opacity:.5;transition:background .12s,opacity .12s}
.seg .o+.o{border-left:1px solid var(--c-line)}
.seg .o:hover{opacity:1;background:rgba(255,255,255,.08)}
.seg .o.on{opacity:1;background:var(--c-white);color:#0a0c10}
.panel .foot{display:flex;gap:1em;margin-top:1.3em;align-items:center}
.panel .foot .btn{font-size:1.1em;border:1px solid var(--c-line);padding:.45em 1.2em}
.panel .foot .btn:hover{transform:none;background:rgba(255,255,255,.12)}
.panel .foot .note{display:none}

/* controls: two columns so every binding fits without scrolling */
.screen.controls .panel{width:clamp(560px,58vw,1400px)}
.screen.controls .rows{display:grid;grid-template-columns:1fr 1fr;column-gap:2.5em;overflow:visible;padding-right:0}
.screen.controls .row{border-bottom:0}
.screen.controls .row:nth-last-child(-n+2){border-bottom:1px solid var(--c-line)}
.screen.controls .row .ctl{min-width:0}

/* ---------------------------------------------------------------- loading */
#loading{position:fixed;inset:0;z-index:30;background:#07090c;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1.4em;
  font-family:var(--font-display);font-stretch:condensed;color:#f2f4f7;font-size:clamp(11px,1.45vh,32px);transition:opacity .45s;pointer-events:auto}
#loading.out{opacity:0;pointer-events:none}
#loading .n{font-size:5.4em;font-weight:800;letter-spacing:.02em;line-height:1}
#loading .n i{font-style:normal;display:inline-block;width:.1em;height:.58em;background:#ff8a1f;margin-left:.12em}
#loading .l{font-size:.85em;letter-spacing:3px;opacity:.55;font-weight:600}
#loading .bar{width:16em;height:2px;background:rgba(255,255,255,.14);overflow:hidden;position:relative}
#loading .bar i{position:absolute;top:0;bottom:0;left:0;width:35%;background:#f2f4f7;animation:loadsweep 1.1s cubic-bezier(.4,0,.6,1) infinite}
#loading .ft{position:absolute;bottom:2.4em;font-size:.72em;letter-spacing:2px;opacity:.32;font-family:var(--font-mono);font-stretch:normal}

/* -------------------------------------------------------------- keyframes */
@keyframes heartbeat{0%,100%{transform:scale(1)}14%{transform:scale(1.08)}28%{transform:scale(1)}42%{transform:scale(1.06)}60%{transform:scale(1)}}
@keyframes vigbeat{0%,100%{opacity:var(--o)}50%{opacity:calc(var(--o)*.55)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes ammoflash{0%{opacity:1}100%{opacity:.62}}
@keyframes loadsweep{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
@keyframes drift{0%{transform:scale(1.02) translate(0,0)}100%{transform:scale(1.09) translate(-1.4%,-1%)}}
`;
