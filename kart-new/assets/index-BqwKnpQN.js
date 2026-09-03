const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./HDRLoader-Cu5c3GZ9.js","./three-d194qEoe.js","./GLTFLoader-DjaFp1g3.js","./BufferGeometryUtils-DyljbVMU.js","./PhysicsSystem-B0fLkISM.js","./TrackConfig-CYY79NHM.js"])))=>i.map(i=>d[i]);
import{t as e}from"./audio-DhH9atRp.js";import{$ as t,A as n,B as r,D as i,Dt as a,Ft as o,N as s,O as c,Pt as l,Q as u,S as d,T as f,Tt as p,_ as m,bt as h,c as g,d as _,dt as v,et as y,f as ee,g as te,gt as ne,jt as re,k as ie,l as b,m as x,n as ae,nt as S,pt as oe,r as se,s as ce,t as le,u as ue,ut as de,vt as fe,wt as pe,xt as C,yt as w,z as me}from"./three-d194qEoe.js";import{n as he,t as ge}from"./TrackConfig-CYY79NHM.js";import{t as _e}from"./BufferGeometryUtils-DyljbVMU.js";import{a as ve,c as ye,i as be,l as xe,n as Se,o as Ce,r as we,s as Te,t as Ee}from"./postprocessing-Bv1tOFEY.js";(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var De=class{fixedDt;maxFrameTime;update;render;accumulator=0;lastTime=0;rafId=0;running=!1;constructor(e){this.fixedDt=e.fixedDt??1/60,this.maxFrameTime=e.maxFrameTime??.25,this.update=e.update,this.render=e.render}start(){this.running||(this.running=!0,this.lastTime=performance.now(),this.accumulator=0,this.rafId=requestAnimationFrame(this.tick))}stop(){this.running=!1,cancelAnimationFrame(this.rafId)}tick=e=>{if(!this.running)return;this.rafId=requestAnimationFrame(this.tick);let t=Math.min((e-this.lastTime)/1e3,this.maxFrameTime);for(this.lastTime=e,this.accumulator+=t;this.accumulator>=this.fixedDt;)this.update(this.fixedDt),this.accumulator-=this.fixedDt;this.render(this.accumulator/this.fixedDt,t)}},Oe=Object.freeze({ua:``,maxTouchPoints:0,screenLongEdge:1280,devicePixelRatio:1,hardwareConcurrency:4,deviceMemoryGB:null,webgl2:!0,maxTextureSize:4096,gpu:``});function ke(e={}){return{...Oe,...e}}function Ae(){if(typeof navigator>`u`||typeof document>`u`)return ke();let e=navigator,t=typeof screen<`u`?Math.max(screen.width,screen.height):window.innerWidth,n=!1,r=Oe.maxTextureSize,i=``,a=document.createElement(`canvas`),o=a.getContext(`webgl2`)??a.getContext(`webgl`);if(o){n=typeof WebGL2RenderingContext<`u`&&o instanceof WebGL2RenderingContext,r=o.getParameter(o.MAX_TEXTURE_SIZE);let e=o.getExtension(`WEBGL_debug_renderer_info`);e&&(i=String(o.getParameter(e.UNMASKED_RENDERER_WEBGL)??``)),o.getExtension(`WEBGL_lose_context`)?.loseContext()}return{ua:e.userAgent??``,maxTouchPoints:e.maxTouchPoints??0,screenLongEdge:t,devicePixelRatio:window.devicePixelRatio||1,hardwareConcurrency:e.hardwareConcurrency||4,deviceMemoryGB:typeof e.deviceMemory==`number`?e.deviceMemory:null,webgl2:n,maxTextureSize:r,gpu:i}}function je(e){return/Android|iPhone|iPod|IEMobile|Opera Mini|Mobile Safari/i.test(e)?!0:/iPad/i.test(e)}function Me(e){return e===`keyboard`||e===`touch`}function Ne(e){return je(e.ua)||e.maxTouchPoints>0&&e.screenLongEdge<=1400?`touch`:`keyboard`}function Pe(e,t=`auto`){let n=Ne(e);return{mode:t===`auto`?n:t,detected:n}}var Fe=[`forward`,`back`,`left`,`right`,`drift`,`brake`,`useItem`],Ie=Object.freeze({forward:`油门`,back:`刹车 / 倒车`,left:`左转`,right:`右转`,drift:`漂移`,brake:`刹车`,useItem:`用道具`}),Le=Object.freeze({left:[`ArrowLeft`,`KeyA`],right:[`ArrowRight`,`KeyD`],forward:[`ArrowUp`,`KeyW`],back:[`ArrowDown`,`KeyS`],brake:[`Space`],drift:[`ShiftLeft`,`ShiftRight`],useItem:[`KeyQ`]}),Re=3;function ze(e){let t={},n=e&&typeof e==`object`?e:{};for(let e of Fe){let r=n[e],i=Array.isArray(r)?r.filter(e=>typeof e==`string`&&e.length>0&&e.length<=32):[],a=[...new Set(i)].slice(0,Re);t[e]=a.length>0?a:[...Le[e]]}return t}function Be(e){return Fe.every(t=>e[t].length===Le[t].length&&e[t].every((e,n)=>e===Le[t][n]))}function Ve(e){let t=new Map;for(let n of Fe)for(let r of e[n])t.has(r)||t.set(r,n);return t}function He(e,t,n,r){let i={};for(let t of Fe)i[t]=[...e[t]];for(let e of Fe)i[e]=i[e].filter(e=>e!==r);let a=i[t];return n>=0&&n<a.length?a[n]=r:a.length<Re?a.push(r):a[a.length-1]=r,ze(i)}function Ue(e){return We[e]||(/^Key[A-Z]$/.test(e)?e.slice(3):/^Digit\d$/.test(e)?e.slice(5):/^Numpad\d$/.test(e)?`小键盘${e.slice(6)}`:(/^F\d{1,2}$/.test(e),e))}var We=Object.freeze({ArrowUp:`↑`,ArrowDown:`↓`,ArrowLeft:`←`,ArrowRight:`→`,Space:`空格`,ShiftLeft:`左 Shift`,ShiftRight:`右 Shift`,ControlLeft:`左 Ctrl`,ControlRight:`右 Ctrl`,AltLeft:`左 Alt`,AltRight:`右 Alt`,Enter:`回车`,Tab:`Tab`,Backspace:`退格`,Escape:`Esc`,Comma:`,`,Period:`.`,Slash:`/`,Semicolon:`;`,Quote:`'`,BracketLeft:`[`,BracketRight:`]`,Backslash:`\\`,Minus:`-`,Equal:`=`,Backquote:"`"}),Ge=[`Escape`,`Tab`,`F5`,`F11`,`F12`];function Ke(e){return e.length>0&&!Ge.includes(e)}var qe=[`low`,`medium`,`high`],Je=Object.freeze({high:Object.freeze({maxPixelRatio:2,antialias:!1,shadowMapSize:2048,shadowRadius:70,blobShadows:!1,postFx:`full`,bloomStrength:.42,aiCount:7,sparkCapacity:400,aiSparks:!0,propDensity:1,fogNear:180,fogFar:620,cameraFar:900,maxTextureSize:2048,textureAnisotropy:8,bloomRadius:.55,smaa:!0,vignette:.32,envMapSize:256,dustCapacity:160,burstCapacity:320,boostTrail:!0}),medium:Object.freeze({maxPixelRatio:1.5,antialias:!1,shadowMapSize:1024,shadowRadius:55,blobShadows:!1,postFx:`bloom`,bloomStrength:.28,aiCount:5,sparkCapacity:220,aiSparks:!0,propDensity:.55,fogNear:130,fogFar:420,cameraFar:620,maxTextureSize:2048,textureAnisotropy:4,bloomRadius:.4,smaa:!1,vignette:.22,envMapSize:128,dustCapacity:80,burstCapacity:180,boostTrail:!0}),low:Object.freeze({maxPixelRatio:1,antialias:!1,shadowMapSize:0,shadowRadius:0,blobShadows:!0,postFx:`none`,bloomStrength:0,aiCount:3,sparkCapacity:100,aiSparks:!1,propDensity:.25,fogNear:80,fogFar:240,cameraFar:360,maxTextureSize:1024,textureAnisotropy:1,bloomRadius:0,smaa:!1,vignette:0,envMapSize:0,dustCapacity:0,burstCapacity:60,boostTrail:!1})}),Ye=Object.freeze({drawCalls:150,triangles:2e5,textureSize:1024});function Xe(e){return e===`high`||e===`medium`||e===`low`}function Ze(e){let t=qe.indexOf(e);return t>0?qe[t-1]:null}function Qe(e){if(!e.webgl2||e.maxTextureSize<4096||et(e.gpu))return`low`;if(!(je(e.ua)||e.maxTouchPoints>0&&e.screenLongEdge<=1400))return e.hardwareConcurrency<=2?`medium`:`high`;let t=0;return e.hardwareConcurrency>=8?t+=2:e.hardwareConcurrency>=6?t+=1:e.hardwareConcurrency<=3&&--t,e.deviceMemoryGB!==null&&(e.deviceMemoryGB>=6?t+=2:e.deviceMemoryGB>=4?t+=1:e.deviceMemoryGB<=2&&(t-=2)),t+=$e(e.gpu),e.devicePixelRatio>=3&&--t,t>=3?`high`:t>=1?`medium`:`low`}function $e(e){let t=e.toLowerCase();if(!t)return 0;if(/apple\s*(a1[4-9]|a[2-9]\d|m\d)/.test(t))return 2;if(/apple/.test(t))return 1;let n=/adreno.*?(\d{3})/.exec(t);if(n){let e=Number(n[1]);return e>=700?2:e>=640?1:e<600?-2:0}return/mali-g[7-9]\d/.test(t)?1:/mali-t|mali-g5|mali-g3/.test(t)?-2:0}function et(e){return/swiftshader|llvmpipe|software|basic render/i.test(e)}function tt(e,t=`auto`){let n=Qe(e),r=t===`auto`?n:t;return{tier:r,settings:Je[r],detected:n}}function nt(e,t){return Math.min(t||1,e.maxPixelRatio)}var rt={id:`dunes`,name:`沙丘飞坡`,subtitle:`大起大落，坡顶会腾空`,difficulty:3,laps:3,points:[[178,21.1,0],[160,28.5,77],[102,26.5,128],[32,16.6,141],[-30,6.2,133],[-90,3.2,113],[-146,9.8,70],[-178,21.1,0],[-160,28.5,-77],[-102,26.5,-128],[-32,16.6,-141],[30,6.2,-133],[90,3.2,-113],[146,9.8,-70]],config:{...ge,skirtBottomY:-14},itemBoxRows:[{t:.2,lanes:[-5,-2.5,0,2.5,5]},{t:.45,lanes:[-4,0,4]},{t:.7,lanes:[-5,-2.5,0,2.5,5]},{t:.95,lanes:[-4,0,4]}],sky:{top:`#3f9ae0`,horizon:`#ffe3b0`,bottom:`#c9a878`,sun:`#fff6d8`},decor:{cones:180,blocks:200,pillarRatio:.4,radius:[24,500],palette:[`#e0b070`,`#d89050`,`#f0d8a8`,`#c07848`,`#a8683c`,`#fff0d0`],groundColor:`#c8a067`,groundLineColor:`rgba(255,240,210,0.08)`}},it={id:`meadow`,name:`草原环线`,subtitle:`又宽又平，全程不用松油门`,difficulty:1,laps:3,points:[[141,7,0],[133,7.1,77],[73,5.1,126],[0,3,123],[-55,2.9,95],[-103,4.9,59],[-141,7,0],[-133,7.1,-77],[-73,5.1,-126],[0,3,-123],[55,2.9,-95],[103,4.9,-59]],config:{...ge,trackWidth:20,shoulderWidth:2.8},itemBoxRows:[{t:.1,lanes:[-6,-3,0,3,6]},{t:.3,lanes:[-4.5,0,4.5]},{t:.52,lanes:[-6,-3,0,3,6]},{t:.74,lanes:[-4.5,0,4.5]}],sky:{top:`#2f86dd`,horizon:`#a9daff`,bottom:`#7ea7bd`,sun:`#ffeec4`},decor:{cones:260,blocks:235,pillarRatio:.23,radius:[20,480],palette:[`#ff5d5d`,`#ffd23f`,`#3ddc97`,`#4d9bff`,`#ff8ac4`,`#ffffff`],groundColor:`#4f7a45`,groundLineColor:`rgba(255,255,255,0.10)`}},at={id:`ridge`,name:`山脊长道`,subtitle:`又窄又长，弯里必须减速`,difficulty:3,laps:2,points:[[177,8.1,0],[184,7.7,67],[116,5.7,98],[59,3.9,102],[26,4.3,148],[-34,6.3,192],[-89,8.1,155],[-98,7.7,82],[-119,5.7,43],[-177,3.9,0],[-184,4.3,-67],[-116,6.3,-98],[-59,8.1,-102],[-26,7.7,-148],[34,5.7,-192],[89,3.9,-155],[98,4.3,-82],[119,6.3,-43]],config:{...ge,trackWidth:15,shoulderWidth:2.2,meshSegments:560},itemBoxRows:[{t:.06,lanes:[-4.5,-2.2,0,2.2,4.5]},{t:.2,lanes:[-3.5,0,3.5]},{t:.35,lanes:[-4.5,-2.2,0,2.2,4.5]},{t:.5,lanes:[-3.5,0,3.5]},{t:.64,lanes:[-4.5,-2.2,0,2.2,4.5]},{t:.79,lanes:[-3.5,0,3.5]},{t:.91,lanes:[-3.5,0,3.5]}],sky:{top:`#1d5fa8`,horizon:`#d8ecf7`,bottom:`#93a8b5`,sun:`#f2f8ff`},decor:{cones:300,blocks:250,pillarRatio:.34,radius:[18,460],palette:[`#8fb3c9`,`#c9d8e0`,`#6f8fa8`,`#a8c4b0`,`#e8eef2`,`#5f7a8c`],groundColor:`#556b52`,groundLineColor:`rgba(220,240,255,0.12)`}},ot=Object.freeze({meadow:it,sunset:{id:`sunset`,name:`黄昏赛道`,subtitle:`标准长度，几个弯要减速`,difficulty:2,laps:3,points:[[168,11.3,0],[142,12.3,52],[118,10.8,99],[85,8.1,147],[23,6.2,133],[-17,6.5,96],[-62,8.2,108],[-118,9.4,99],[-124,8.4,45],[-128,5.4,0],[-154,2,-56],[-126,.1,-106],[-67,0,-116],[-25,1,-141],[27,2.1,-154],[58,3.5,-100],[71,5.6,-60],[128,8.6,-47]],config:ge,itemBoxRows:[{t:.08,lanes:[-5,-2.5,0,2.5,5]},{t:.24,lanes:[-4,0,4]},{t:.38,lanes:[-5,-2.5,0,2.5,5]},{t:.52,lanes:[-4,0,4]},{t:.66,lanes:[-5,-2.5,0,2.5,5]},{t:.81,lanes:[-4,0,4]}],sky:{top:`#2a6bb8`,horizon:`#ffcfa0`,bottom:`#8a7a86`,sun:`#ffdfa0`},decor:{cones:260,blocks:235,pillarRatio:.23,radius:[20,480],palette:[`#ff7a4d`,`#ffc043`,`#e0d8a8`,`#7fa6d8`,`#c98cd0`,`#fff0d8`],groundColor:`#5c6b3f`,groundLineColor:`rgba(255,220,180,0.12)`}},ridge:at,dunes:rt}),st=[`meadow`,`sunset`,`ridge`,`dunes`],ct=`sunset`;function lt(e){return typeof e==`string`&&Object.hasOwn(ot,e)}function ut(e){return ot[e]}var dt=Object.freeze({single:{id:`single`,name:`单场比赛`,subtitle:`选一条赛道，和 AI 跑一局`,ai:!0,ghost:!1,recordGhost:!1,cup:!1,items:!0},cup:{id:`cup`,name:`杯赛`,subtitle:`连跑四条，积分决冠军`,ai:!0,ghost:!1,recordGhost:!1,cup:!0,items:!0},timeTrial:{id:`timeTrial`,name:`计时赛`,subtitle:`没有对手，只和自己的幽灵车比`,ai:!1,ghost:!0,recordGhost:!0,cup:!1,items:!1}}),ft=[`single`,`cup`,`timeTrial`];function pt(e){return typeof e==`string`&&Object.hasOwn(dt,e)}var mt=[`easy`,`normal`,`hard`],ht={easy:{speedMul:.85,driver:{lookAheadDistance:13,lookAheadPerSpeed:.28,steerGain:1.6,liftAngle:.16,fullLiftAngle:.6,minThrottle:.42,brakeAngle:.85,useDrift:!1},rubberband:{behindRange:.1,aheadRange:.05,maxMultiplier:1.15,minMultiplier:.85,smoothing:.7}},normal:{speedMul:.94,driver:{lookAheadDistance:18,lookAheadPerSpeed:.34,steerGain:2,liftAngle:.22,fullLiftAngle:.72,minThrottle:.55,brakeAngle:1,useDrift:!0,driftAngleThreshold:.42},rubberband:{behindRange:.09,aheadRange:.07,maxMultiplier:1.1,minMultiplier:.9,smoothing:.8}},hard:{speedMul:1,driver:{lookAheadDistance:23,lookAheadPerSpeed:.4,steerGain:2.3,liftAngle:.3,fullLiftAngle:.85,minThrottle:.7,brakeAngle:1.15,useDrift:!0,driftAngleThreshold:.34,driftMinHold:.7},rubberband:{behindRange:.08,aheadRange:.09,maxMultiplier:1.06,minMultiplier:.96,smoothing:1}}},gt=[{name:`蓝闪`,laneOffset:-5,targetGap:.06,speedMul:1.02,color:`#2f6fed`,accent:`#8fd0ff`},{name:`青柠`,laneOffset:5,targetGap:.04,speedMul:.99,color:`#39c46a`,accent:`#eaff9b`},{name:`橘子`,laneOffset:-2.5,targetGap:.02,speedMul:1.01,color:`#ff8c1a`,accent:`#ffd9a3`},{name:`紫电`,laneOffset:2.5,targetGap:0,speedMul:.98,color:`#9b5cf6`,accent:`#e2ccff`},{name:`雪白`,laneOffset:-6.5,targetGap:-.02,speedMul:1,color:`#e8e8ee`,accent:`#9aa3b2`},{name:`墨黑`,laneOffset:6.5,targetGap:-.04,speedMul:1,color:`#3a3f4b`,accent:`#ffd34d`},{name:`粉桃`,laneOffset:0,targetGap:-.06,speedMul:.97,color:`#ff5fa2`,accent:`#ffd7e8`}];gt.length;function _t(e){return gt[e%gt.length]}var vt=[15,12,10,8,6,4,2,1];function yt(e){return!Number.isInteger(e)||e<1?0:vt[e-1]??0}var bt=Object.freeze({grand:{id:`grand`,name:`大奖杯`,subtitle:`四条赛道，由易到难`,trackIds:st},reverse:{id:`reverse`,name:`逆行杯`,subtitle:`同样四条，从最难的开始`,trackIds:[...st].reverse()}}),xt=[`grand`,`reverse`];function St(e){return typeof e==`string`&&Object.hasOwn(bt,e)}var Ct=`player`;function wt(e){return`ai${e}`}function Tt(e,t){return{cupId:e,aiCount:Math.max(0,Math.floor(t)),results:[]}}function Et(e){return bt[e.cupId].trackIds[e.results.length]??null}function Dt(e){return Math.min(e.results.length+1,Ot(e))}function Ot(e){return bt[e.cupId].trackIds.length}function kt(e){return e.results.length>=Ot(e)}function At(e,t){return kt(e)?e:{...e,results:[...e.results,t]}}function jt(e){let t=[Ct,...Array.from({length:e.aiCount},(e,t)=>wt(t))].map(t=>{let n=t===Ct,r=n?null:_t(Nt(t)),i=e.results.map(e=>e.places[t]??null),a=i.reduce((e,t)=>e+(t?yt(t):0),0),o=i.filter(e=>e!==null);return{racerId:t,name:n?`你`:r?.name??t,color:n?Mt:r?.color??`#ffffff`,isPlayer:n,points:a,place:0,rounds:i,wins:o.filter(e=>e===1).length,best:o.length>0?Math.min(...o):1/0}});return t.sort((e,t)=>t.points-e.points||t.wins-e.wins||e.best-t.best||e.racerId.localeCompare(t.racerId)),t.forEach((e,t)=>e.place=t+1),t.map(({wins:e,best:t,...n})=>n)}var Mt=`#ff3b30`;function Nt(e){let t=Number.parseInt(e.slice(2),10);return Number.isFinite(t)?t:0}var Pt=`kart-new.cup.v1`;function Ft(e){if(!e||typeof e!=`object`)return null;let t=e;if(!St(t.cupId))return null;let n=t.aiCount;if(typeof n!=`number`||!Number.isFinite(n)||n<0||n>16)return null;let r=bt[t.cupId].trackIds.length,i=Array.isArray(t.results)?t.results:[],a=[];for(let e of i.slice(0,r)){if(!e||typeof e!=`object`)return null;let t=e;if(!lt(t.trackId)||!t.places||typeof t.places!=`object`)return null;let n={};for(let[e,r]of Object.entries(t.places)){if(typeof r!=`number`||!Number.isInteger(r)||r<1)return null;n[e]=r}let r=typeof t.playerTime==`number`&&Number.isFinite(t.playerTime)?t.playerTime:null;a.push({trackId:t.trackId,places:n,playerTime:r})}return{cupId:t.cupId,aiCount:Math.floor(n),results:a}}var It=class{storage;key;constructor(e,t=Pt){this.storage=e,this.key=t}load(){try{let e=this.storage?.getItem(this.key);return e?Ft(JSON.parse(e)):null}catch{return null}}save(e){try{this.storage?.setItem(this.key,JSON.stringify(e))}catch{}}clear(){try{this.storage?.removeItem(this.key)}catch{}}};function Lt(){try{return typeof localStorage>`u`?null:localStorage}catch{return null}}var Rt=Object.freeze({quality:`auto`,input:`auto`,volume:.8,musicVolume:.55,muted:!1,track:ct,mode:`single`,cup:`grand`,keys:ze(null),handed:`right`}),zt=`kart.prefs.v3`;function Bt(e){let t={...Rt};if(!e||typeof e!=`object`)return t;let n=e;return(n.quality===`auto`||Xe(n.quality))&&(t.quality=n.quality),(n.input===`auto`||Me(n.input))&&(t.input=n.input),lt(n.track)&&(t.track=n.track),pt(n.mode)&&(t.mode=n.mode),St(n.cup)&&(t.cup=n.cup),t.volume=Vt(n.volume,Rt.volume),t.musicVolume=Vt(n.musicVolume,Rt.musicVolume),typeof n.muted==`boolean`&&(t.muted=n.muted),(n.handed===`left`||n.handed===`right`)&&(t.handed=n.handed),t.keys=ze(n.keys),t}function Vt(e,t){return typeof e==`number`&&Number.isFinite(e)&&e>=0&&e<=1?e:t}function Ht(){try{return typeof localStorage>`u`?null:localStorage}catch{return null}}function Ut(e=Ht()){if(!e)return{...Rt};try{let t=e.getItem(zt);return Bt(t?JSON.parse(t):null)}catch{return{...Rt}}}function Wt(e,t){let n=new URLSearchParams(t),r=n.get(`mute`);return Bt({...e,quality:n.get(`quality`)??e.quality,input:n.get(`input`)??e.input,track:n.get(`track`)??e.track,mode:n.get(`mode`)??e.mode,muted:r===null?e.muted:r!==`0`&&r!==`false`})}function T(e,t=Ht()){if(t)try{t.setItem(zt,JSON.stringify(Bt(e)))}catch{}}var Gt=Object.freeze({steer:0,throttle:0,brake:0,drift:!1,useItem:!1});function Kt(){return{...Gt}}var qt=class{target;held=new Set;lookup;state=Kt();usePending=!1;constructor(e=window,t=Le){this.target=e,this.lookup=Ve(t),this.target.addEventListener(`keydown`,this.onKeyDown),this.target.addEventListener(`keyup`,this.onKeyUp),this.target.addEventListener(`mousedown`,this.onMouseDown),this.target.addEventListener(`contextmenu`,this.onContextMenu),window.addEventListener(`blur`,this.onBlur)}setBindings(e){this.lookup=Ve(e),this.held.clear(),this.usePending=!1}onKeyDown=e=>{let t=e;if(t.repeat)return;let n=this.lookup.get(t.code);n&&(t.preventDefault(),this.held.add(n),n===`useItem`&&(this.usePending=!0))};onMouseDown=e=>{e.button===2&&(e.preventDefault(),this.usePending=!0)};onContextMenu=e=>e.preventDefault();onKeyUp=e=>{let t=this.lookup.get(e.code);t&&this.held.delete(t)};onBlur=()=>{this.held.clear(),this.usePending=!1};sample(){let e=this.state;return e.steer=+!!this.held.has(`right`)-!!this.held.has(`left`),e.throttle=+!!this.held.has(`forward`),e.brake=this.held.has(`brake`)||this.held.has(`back`)?1:0,e.drift=this.held.has(`drift`),e.useItem=this.usePending,this.usePending=!1,e}dispose(){this.target.removeEventListener(`keydown`,this.onKeyDown),this.target.removeEventListener(`keyup`,this.onKeyUp),this.target.removeEventListener(`mousedown`,this.onMouseDown),this.target.removeEventListener(`contextmenu`,this.onContextMenu),window.removeEventListener(`blur`,this.onBlur),this.held.clear(),this.usePending=!1}},Jt=Object.freeze({radius:64,deadzone:.12,curve:1.35}),Yt=(e,t,n)=>e<t?t:e>n?n:e;function Xt(e,t=Jt){let n=Yt(e/Math.max(t.radius,1),-1,1),r=Math.abs(n),i=Yt(t.deadzone,0,.95);if(r<=i)return 0;let a=(r-i)/(1-i);return Math.sign(n)*a**Math.max(t.curve,.05)}function Zt(e,t,n,r={x:0,y:0}){let i=Math.hypot(e,t),a=i>n&&i>0?n/i:1;return r.x=e*a,r.y=t*a,r}var Qt=[{action:`throttle`,className:`touch-btn-throttle`,label:`▲`,hint:`油门`},{action:`brake`,className:`touch-btn-brake`,label:`▼`,hint:`刹车`},{action:`drift`,className:`touch-btn-drift`,label:`DRIFT`,hint:`漂移`},{action:`item`,className:`touch-btn-item`,label:`道具`,hint:`使用道具`}],$t=class{root;steerConfig;state=Kt();held=new Set;pointerAction=new Map;usePending=!1;handed;stickZone;stickBase;stickKnob;stickPointer=-1;stickOriginX=0;stickOriginY=0;stickDx=0;knob={x:0,y:0};constructor(e,t={}){this.steerConfig={...Jt,...t.steer},this.handed=t.handed??`right`,nn(),this.root=document.createElement(`div`),this.root.className=`touch-controls`,t.handed===`left`&&this.root.classList.add(`is-left-handed`),this.root.style.setProperty(`--stick-radius`,`${this.steerConfig.radius}px`),this.stickZone=document.createElement(`div`),this.stickZone.className=`touch-stick-zone`,this.stickBase=document.createElement(`div`),this.stickBase.className=`touch-stick-base`,this.stickKnob=document.createElement(`div`),this.stickKnob.className=`touch-stick-knob`,this.stickBase.appendChild(this.stickKnob),this.stickZone.appendChild(this.stickBase),this.root.appendChild(this.stickZone);let n=document.createElement(`div`);n.className=`touch-pad`;for(let e of Qt){let t=document.createElement(`div`);t.className=`touch-btn ${e.className}`,t.dataset.action=e.action,t.innerHTML=`<span class="touch-btn-label">${e.label}</span><span class="touch-btn-hint">${e.hint}</span>`,t.addEventListener(`pointerdown`,this.onButtonDown),t.addEventListener(`pointerup`,this.onButtonUp),t.addEventListener(`pointercancel`,this.onButtonUp),(e.action===`item`?this.root:n).appendChild(t)}this.root.appendChild(n),this.stickZone.addEventListener(`pointerdown`,this.onStickDown),this.stickZone.addEventListener(`pointermove`,this.onStickMove),this.stickZone.addEventListener(`pointerup`,this.onStickUp),this.stickZone.addEventListener(`pointercancel`,this.onStickUp),this.root.addEventListener(`contextmenu`,en),document.addEventListener(`visibilitychange`,this.onVisibilityChange),e.appendChild(this.root)}onStickDown=e=>{if(this.stickPointer!==-1)return;e.preventDefault(),this.stickPointer=e.pointerId,this.stickZone.setPointerCapture(e.pointerId);let t=this.stickZone.getBoundingClientRect();this.stickOriginX=e.clientX,this.stickOriginY=e.clientY,this.stickBase.style.left=`${e.clientX-t.left}px`,this.stickBase.style.top=`${e.clientY-t.top}px`,this.stickBase.classList.add(`is-active`),this.moveStick(e.clientX,e.clientY)};onStickMove=e=>{e.pointerId===this.stickPointer&&(e.preventDefault(),this.moveStick(e.clientX,e.clientY))};onStickUp=e=>{e.pointerId===this.stickPointer&&this.releaseStick()};moveStick(e,t){this.stickDx=e-this.stickOriginX,Zt(this.stickDx,t-this.stickOriginY,this.steerConfig.radius,this.knob),this.stickKnob.style.transform=`translate(-50%, -50%) translate(${this.knob.x}px, ${this.knob.y}px)`}releaseStick(){this.stickPointer=-1,this.stickDx=0,this.stickBase.classList.remove(`is-active`),this.stickKnob.style.transform=`translate(-50%, -50%)`}onButtonDown=e=>{let t=e.currentTarget,n=t.dataset.action;n&&(e.preventDefault(),t.setPointerCapture(e.pointerId),t.classList.add(`is-pressed`),this.pointerAction.set(e.pointerId,n),n===`item`?this.usePending=!0:this.held.add(n))};onButtonUp=e=>{let t=this.pointerAction.get(e.pointerId);t&&(this.pointerAction.delete(e.pointerId),e.currentTarget.classList.remove(`is-pressed`),[...this.pointerAction.values()].includes(t)||this.held.delete(t))};onVisibilityChange=()=>{document.visibilityState===`hidden`&&this.releaseAll()};releaseAll(){this.held.clear(),this.pointerAction.clear(),this.usePending=!1,this.releaseStick();for(let e of this.root.querySelectorAll(`.is-pressed`))e.classList.remove(`is-pressed`)}setVisible(e){this.root.style.display=e?``:`none`,e||this.releaseAll()}sample(){let e=this.state;return e.steer=this.stickPointer===-1?0:Xt(this.stickDx,this.steerConfig),e.throttle=+!!this.held.has(`throttle`),e.brake=+!!this.held.has(`brake`),e.drift=this.held.has(`drift`),e.useItem=this.usePending,this.usePending=!1,e}setHanded(e){this.handed!==e&&(this.handed=e,this.root.classList.toggle(`is-left-handed`,e===`left`),this.releaseStick())}dispose(){document.removeEventListener(`visibilitychange`,this.onVisibilityChange),this.releaseAll(),this.root.remove()}},en=e=>e.preventDefault(),tn=!1;function nn(){if(tn)return;tn=!0;let e=document.createElement(`style`);e.textContent=`
    /* 触控层本身不吃事件，只有摇杆区和按钮吃 —— 中间那块要留给以后可能加的点击操作 */
    .touch-controls {
      position: absolute; inset: 0; pointer-events: none;
      touch-action: none; -webkit-user-select: none; user-select: none;
      -webkit-tap-highlight-color: transparent;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      z-index: 30;
    }
    .touch-controls * { touch-action: none; }

    /* 摇杆区：左下一大块。宁可大也不要小 —— 摸不准的代价是撞墙 */
    .touch-stick-zone {
      position: absolute; left: 0; bottom: 0;
      width: 46%; height: 68%;
      pointer-events: auto;
      padding: 0 0 env(safe-area-inset-bottom) env(safe-area-inset-left);
    }
    .touch-stick-base {
      position: absolute; left: 50%; top: 60%;
      width: calc(var(--stick-radius) * 2); height: calc(var(--stick-radius) * 2);
      margin-left: calc(var(--stick-radius) * -1); margin-top: calc(var(--stick-radius) * -1);
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.28);
      background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.10), rgba(0,0,0,0.18));
      opacity: 0.35; transition: opacity 120ms ease;
    }
    .touch-stick-base.is-active { opacity: 0.9; }
    .touch-stick-knob {
      position: absolute; left: 50%; top: 50%;
      width: calc(var(--stick-radius) * 1.05); height: calc(var(--stick-radius) * 1.05);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255,255,255,0.72);
      box-shadow: 0 2px 10px rgba(0,0,0,0.45);
    }

    /* 右下角按钮组：油门最大最靠角，刹车在它左边，漂移在它上面 */
    .touch-pad {
      position: absolute;
      right: calc(18px + env(safe-area-inset-right));
      bottom: calc(18px + env(safe-area-inset-bottom));
      display: grid;
      grid-template-areas: ". drift" "brake throttle";
      gap: 12px;
      pointer-events: none;
    }
    .touch-btn {
      pointer-events: auto;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.35);
      background: rgba(12,16,24,0.42);
      color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.6);
      backdrop-filter: blur(3px);
      transition: transform 70ms ease, background 70ms ease;
    }
    .touch-btn.is-pressed { transform: scale(0.92); background: rgba(255,255,255,0.34); }
    .touch-btn-label { font-size: 20px; font-weight: 700; line-height: 1; }
    .touch-btn-hint { font-size: 10px; opacity: 0.75; margin-top: 3px; }

    .touch-btn-throttle {
      grid-area: throttle;
      width: clamp(76px, 17vmin, 128px); height: clamp(76px, 17vmin, 128px);
      background: rgba(60,180,110,0.34); border-color: rgba(120,255,190,0.5);
    }
    .touch-btn-brake {
      grid-area: brake;
      width: clamp(62px, 13vmin, 100px); height: clamp(62px, 13vmin, 100px);
      background: rgba(200,70,70,0.32); border-color: rgba(255,150,150,0.5);
    }
    .touch-btn-drift {
      grid-area: drift;
      width: clamp(66px, 14vmin, 108px); height: clamp(66px, 14vmin, 108px);
      background: rgba(70,120,220,0.32); border-color: rgba(150,190,255,0.55);
    }
    .touch-btn-drift .touch-btn-label { font-size: 13px; letter-spacing: 1px; }
    .touch-btn-item {
      position: absolute;
      top: calc(14px + env(safe-area-inset-top));
      right: calc(18px + env(safe-area-inset-right));
      width: clamp(58px, 12vmin, 92px); height: clamp(58px, 12vmin, 92px);
      background: rgba(230,180,40,0.30); border-color: rgba(255,225,140,0.55);
    }
    .touch-btn-item .touch-btn-label { font-size: 14px; }
    .touch-btn-item .touch-btn-hint { display: none; }

    /* --- 左手布局：整个控件区左右镜像 ---
       所有位置本来就是成对写的（摇杆 left / 按钮组 right），所以换手就是把这一对
       互换，不需要第二套 DOM，也不用重建适配器。
       注意安全区也要跟着换边：刘海在横屏时只在一侧 */
    .touch-controls.is-left-handed .touch-stick-zone {
      left: auto; right: 0;
      padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) 0;
    }
    .touch-controls.is-left-handed .touch-pad {
      right: auto;
      left: calc(18px + env(safe-area-inset-left));
      /* 油门在最靠角那一格：镜像之后"角"换到了左边 */
      grid-template-areas: "drift ." "throttle brake";
    }
    .touch-controls.is-left-handed .touch-btn-item {
      right: auto;
      left: calc(18px + env(safe-area-inset-left));
    }

    /* 屏幕矮的时候（横屏手机）整体缩一点，别把画面挡完 */
    @media (max-height: 420px) {
      .touch-stick-zone { height: 78%; }
      .touch-pad { gap: 9px; bottom: calc(10px + env(safe-area-inset-bottom)); }
    }
  `,document.head.appendChild(e)}var rn={maxSpeed:34,maxReverseSpeed:10,engineAccel:15,reverseAccel:9,brakeDecel:34,coastFriction:8,turnRate:2.7,steerAuthoritySpeed:3,highSpeedSteerFactor:.42,steerSmoothing:12,corneringDrag:1.6,driftMinSpeed:9,driftSteerDeadzone:.15,driftYaw:.42,driftYawSmoothing:8,driftTurnRate:3.6,driftCounterSteer:.35,driftFriction:1.5,chargeThresholds:[.6,1.4,2.2],boostSpeedMul:[1.12,1.22,1.34],boostDuration:[.6,1.1,1.7],boostAccelMul:3.5,boostFalloffDecel:6,groundStickSmoothing:16,groundNormalSmoothing:7,gravity:26,respawnDelay:2,wallDecel:22},an={maxSpeed:[5,80,.5],maxReverseSpeed:[2,30,.5],engineAccel:[2,60,.5],reverseAccel:[2,40,.5],brakeDecel:[5,100,.5],coastFriction:[0,40,.25],turnRate:[.5,6,.05],steerAuthoritySpeed:[.1,15,.1],highSpeedSteerFactor:[.05,1,.01],steerSmoothing:[1,40,.5],corneringDrag:[0,10,.05],driftMinSpeed:[0,30,.5],driftSteerDeadzone:[0,.9,.01],driftYaw:[0,1.2,.01],driftYawSmoothing:[1,30,.5],driftTurnRate:[.5,9,.05],driftCounterSteer:[.05,1,.01],driftFriction:[0,15,.25],boostAccelMul:[1,10,.1],boostFalloffDecel:[.5,40,.5],groundStickSmoothing:[1,40,.5],groundNormalSmoothing:[1,30,.5],gravity:[1,60,.5],respawnDelay:[.2,8,.1],wallDecel:[0,60,.5]},on={chargeThresholds:{range:[.1,5,.05],label:`蓄力阈值`},boostSpeedMul:{range:[1,2.5,.01],label:`速度倍率`},boostDuration:{range:[.1,5,.05],label:`持续时间`}},sn=[`一档`,`二档`,`三档`];function cn(e=rn){return{...e,chargeThresholds:[...e.chargeThresholds],boostSpeedMul:[...e.boostSpeedMul],boostDuration:[...e.boostDuration]}}var ln=Object.freeze({onTrack:!0,height:0,normalX:0,normalY:1,normalZ:0,progress:0,lateral:0,halfWidth:1/0,toCenterX:0,toCenterZ:0,respawnX:0,respawnY:0,respawnZ:0,respawnHeading:0});function un(){return{...ln,halfWidth:0}}function dn(e=0,t=0,n=0,r=0){return{x:e,z:t,y:r,heading:n,speed:0,steer:0,yawRate:0,driftPhase:`none`,driftDir:0,driftCharge:0,driftLevel:0,driftYawOffset:0,boostTime:0,boostLevel:0,vy:0,airborne:!1,fallTime:0,groundNormalX:0,groundNormalY:1,groundNormalZ:0,trackProgress:0,lateralOffset:0}}function fn(e){return{...e}}var pn=(e,t,n)=>e<t?t:e>n?n:e,E=(e,t,n)=>e+(t-e)*n;function mn(e,t,n){let r=t-e;return Math.abs(r)<=n?t:e+Math.sign(r)*n}var hn=.05;function gn(e,t,n){return e>=t?e:Math.min(t,e+n)}function _n(e,t){let n=0;for(let r=0;r<3;r++)e>=(t[r]??1/0)&&(n=r+1);return n}function vn(e,t){return e.boostTime<=0||e.boostLevel===0?t.maxSpeed:t.maxSpeed*(t.boostSpeedMul[e.boostLevel-1]??1)}function yn(e,t,n,r,i){if(i<=0)return fn(e);let a=pn(t.throttle,0,1),o=pn(t.brake,0,1),s=pn(t.steer,-1,1),c=E(e.steer,s,1-Math.exp(-r.steerSmoothing*i)),l=e.boostTime>0&&e.boostLevel>0,u=vn(e,r),d=e.speed,f=d>hn;d=o>0&&f?Math.max(0,d-r.brakeDecel*o*i):o>0&&!f?Math.max(-r.maxReverseSpeed,d-r.reverseAccel*o*i):l?gn(d,u,r.engineAccel*r.boostAccelMul*i):a>0?d<0?Math.min(0,d+r.brakeDecel*a*i):gn(d,r.maxSpeed,r.engineAccel*a*i):mn(d,0,r.coastFriction*i),d>u&&(d=mn(d,u,r.boostFalloffDecel*i)),d<-r.maxReverseSpeed&&(d=-r.maxReverseSpeed);let p=e.driftPhase,m=e.driftDir,h=e.driftCharge,g=e.driftLevel,_=Math.max(0,e.boostTime-i),v=_>0?e.boostLevel:0,y=d>r.driftMinSpeed,ee=Math.abs(s)>=r.driftSteerDeadzone;if(p===`drifting`){if(!y)p=`none`,m=0,h=0,g=0;else if(t.drift)h+=i,g=_n(h,r.chargeThresholds);else{if(g>0){let e=r.boostDuration[g-1]??0;e>=_&&(_=e,v=g),p=`boosting`}else p=`none`;m=0,h=0,g=0}}else p===`boosting`&&_<=0&&(p=`none`),t.drift&&ee&&y&&(p=`drifting`,m=s>0?1:-1,h=0,g=0);let te=Math.abs(d),ne=pn(te/r.steerAuthoritySpeed,0,1),re=E(1,r.highSpeedSteerFactor,pn(te/r.maxSpeed,0,1)),ie;if(p===`drifting`&&m!==0){let e=pn(s*m,-1,1),t=E(r.driftCounterSteer,1,(e+1)/2);ie=-r.driftTurnRate*m*t*ne*re}else{let e=d<0?-1:1;ie=-r.turnRate*c*ne*re*e}let b=e.heading+ie*i,x=Math.abs(ie)*r.corneringDrag;p===`drifting`&&(x+=r.driftFriction),x>0&&!l&&(d=mn(d,0,x*i));let ae=p===`drifting`?-r.driftYaw*m:0,S=E(e.driftYawOffset,ae,1-Math.exp(-r.driftYawSmoothing*i)),oe=e.x+Math.sin(b)*d*i,se=e.z+Math.cos(b)*d*i,ce=Math.abs(n.lateral)-n.halfWidth,le=Math.abs(d)*i*1.5+.5,ue=ce>0&&ce<le&&!e.airborne;ue&&(oe+=n.toCenterX*ce,se+=n.toCenterZ*ce,d=mn(d,0,r.wallDecel*i));let de=e.y,fe=e.vy,pe=e.fallTime,C=!n.onTrack&&!ue;if(C){if(pe+=i,pe>=r.respawnDelay){let e=dn(n.respawnX,n.respawnZ,n.respawnHeading,n.respawnY);return e.trackProgress=n.progress,e}fe-=r.gravity*i,de+=fe*i}else pe=0,fe=0,n.onTrack&&(de=E(de,n.height,1-Math.exp(-r.groundStickSmoothing*i)));let w=n.onTrack||C?1-Math.exp(-r.groundNormalSmoothing*i):0,[me,he,ge]=bn(E(e.groundNormalX,C?0:n.normalX,w),E(e.groundNormalY,C?1:n.normalY,w),E(e.groundNormalZ,C?0:n.normalZ,w));return{x:oe,z:se,y:de,heading:b,speed:d,steer:c,yawRate:ie,driftPhase:p,driftDir:m,driftCharge:h,driftLevel:g,driftYawOffset:S,boostTime:_,boostLevel:v,vy:fe,airborne:C,fallTime:pe,groundNormalX:me,groundNormalY:he,groundNormalZ:ge,trackProgress:n.progress,lateralOffset:n.lateral}}function bn(e,t,n){let r=Math.hypot(e,t,n);return r<1e-6?[0,1,0]:[e/r,t/r,n/r]}var xn=Object.freeze([]);function Sn(e,t){let n=e.driftPhase===`drifting`,r=t.driftPhase===`drifting`,i=t.boostTime>e.boostTime&&t.boostLevel>0,a=e.boostTime>0&&t.boostTime<=0,o=r&&n&&t.driftLevel>e.driftLevel;if(!r&&!n&&!i&&!a)return xn;let s=[];return!n&&r&&t.driftDir!==0&&s.push({type:`driftStart`,dir:t.driftDir}),o&&t.driftLevel>0&&s.push({type:`driftLevelUp`,level:t.driftLevel}),n&&!r&&s.push({type:`driftEnd`,level:e.driftLevel,boosted:i}),i&&s.push({type:`boostStart`,level:t.boostLevel}),a&&s.push({type:`boostEnd`}),s.length===0?xn:s}function Cn(e,t,n){return{x:E(e.x,t.x,n),z:E(e.z,t.z,n),y:E(e.y,t.y,n),heading:E(e.heading,t.heading,n),speed:E(e.speed,t.speed,n),steer:E(e.steer,t.steer,n),yawRate:E(e.yawRate,t.yawRate,n),driftYawOffset:E(e.driftYawOffset,t.driftYawOffset,n),driftCharge:E(e.driftCharge,t.driftCharge,n),boostTime:E(e.boostTime,t.boostTime,n),vy:E(e.vy,t.vy,n),fallTime:E(e.fallTime,t.fallTime,n),groundNormalX:E(e.groundNormalX,t.groundNormalX,n),groundNormalY:E(e.groundNormalY,t.groundNormalY,n),groundNormalZ:E(e.groundNormalZ,t.groundNormalZ,n),lateralOffset:E(e.lateralOffset,t.lateralOffset,n),driftPhase:t.driftPhase,driftDir:t.driftDir,driftLevel:t.driftLevel,boostLevel:t.boostLevel,airborne:t.airborne,trackProgress:t.trackProgress}}var wn={radius:1.1,pushRate:14,contactDecel:7,maxHeightDiff:2.5},Tn={radius:[.4,3,.05],pushRate:[1,60,.5],contactDecel:[0,40,.5],maxHeightDiff:[.5,10,.1]},En=e=>e<0?0:e>1?1:e;function Dn(e,t){return Math.abs(e)<=t?0:e-Math.sign(e)*t}function On(e,t=wn,n){if(n<=0||e.length<2)return 0;let r=t.radius*2,i=En(t.pushRate*n),a=0;for(let o=0;o<e.length;o++){let s=e[o];for(let c=o+1;c<e.length;c++){let l=e[c];if(Math.abs(s.y-l.y)>t.maxHeightDiff)continue;let u=l.x-s.x,d=l.z-s.z,f=Math.hypot(u,d);if(f>=r)continue;f<1e-4&&(u=o%2==0?1:-1,d=0,f=1);let p=u/f,m=d/f,h=(r-f)*.5*i;s.x-=p*h,s.z-=m*h,l.x+=p*h,l.z+=m*h;let g=t.contactDecel*n;s.speed=Dn(s.speed,g),l.speed=Dn(l.speed,g),a++}}return a}var kn=40,An=600,jn=class{entries=[];context=new Map;startedAt=Date.now();installed=!1;originalError=null;originalWarn=null;get errorCount(){return this.entries.filter(e=>e.kind!==`console`||e.message.startsWith(`[error]`)).length}get all(){return this.entries}install(){this.installed||(this.installed=!0,window.addEventListener(`error`,this.onError),window.addEventListener(`unhandledrejection`,this.onRejection),this.originalError=console.error.bind(console),this.originalWarn=console.warn.bind(console),console.error=(...e)=>{this.record(`console`,`[error] ${Mn(e)}`),this.originalError?.(...e)},console.warn=(...e)=>{this.record(`console`,`[warn] ${Mn(e)}`),this.originalWarn?.(...e)},window.kartReport=()=>this.report())}setContext(e,t){this.context.set(e,t)}record(e,t,n){let r=t.slice(0,An),i=this.entries[this.entries.length-1];if(i&&i.kind===e&&i.message===r){i.count++;return}this.entries.push({at:Date.now()-this.startedAt,kind:e,message:r,stack:n?.slice(0,An),count:1}),this.entries.length>kn&&this.entries.shift()}onError=e=>{let t=e.filename?` @ ${Nn(e.filename)}:${e.lineno}`:``;this.record(`error`,`${e.message}${t}`,e.error?.stack)};onRejection=e=>{let t=e.reason,n=typeof t==`string`?t:t?.message??String(t);this.record(`rejection`,n,typeof t==`object`?t?.stack:void 0)};report(){let e=[`=== Kart 诊断信息 ===`];e.push(`时间: ${new Date().toISOString()}`),e.push(`页面: ${location.href}`),e.push(`UA: ${navigator.userAgent}`);for(let[t,n]of this.context)e.push(`${t}: ${n}`);e.push(`错误 ${this.entries.length} 条:`),this.entries.length===0&&e.push(`  （没有）`);for(let t of this.entries){let n=t.count>1?` ×${t.count}`:``;e.push(`  [${(t.at/1e3).toFixed(1)}s ${t.kind}${n}] ${t.message}`),t.stack&&e.push(`      ${t.stack.split(`
`).slice(0,3).join(` | `)}`)}return e.join(`
`)}dispose(){this.installed&&(this.installed=!1,window.removeEventListener(`error`,this.onError),window.removeEventListener(`unhandledrejection`,this.onRejection),this.originalError&&(console.error=this.originalError),this.originalWarn&&(console.warn=this.originalWarn))}};function Mn(e){return e.map(e=>{if(typeof e==`string`)return e;if(e instanceof Error)return`${e.name}: ${e.message}`;try{return JSON.stringify(e)}catch{return String(e)}}).join(` `)}function Nn(e){return e.slice(e.lastIndexOf(`/`)+1)}var Pn=class{cfg;group=new c;road;shoulders;walls;skirt;collision;constructor(e,t=ge){this.cfg=t;let n=t.trackWidth/2,r=he(t),i=new In,a=new In,s=new In,c=new In,l=new In,u=t.meshSegments,d=new o,f=new o,p=new o,m=new o,h=new o(0,1,0),g=[],_=[],v=[],y=0,ee=null;for(let i=0;i<=u;i++){let a=i/u;e.getPointAt(a,d),e.getSideAt(a,f),e.getNormalAt(a,p),e.getTangentAt(a,m),ee&&(y+=d.distanceTo(ee)),ee=d.clone();let s=(e,t)=>new o(d.x+f.x*e,d.y+f.y*e+t,d.z+f.z*e),c=p.clone(),l=m.clone();g.push({a:s(-n,0),b:s(n,0),n:c,tan:l,arc:y}),_.push([{a:s(-r,-t.shoulderDrop),b:s(-n,0),n:c,tan:l,arc:y},{a:s(n,0),b:s(r,-t.shoulderDrop),n:c,tan:l,arc:y}]),v.push([{a:s(-r,-t.shoulderDrop),b:s(-r-t.wallThickness,-t.shoulderDrop),n:h,tan:l,arc:y},{a:s(r,-t.shoulderDrop),b:s(r+t.wallThickness,-t.shoulderDrop),n:h,tan:l,arc:y}])}for(let e of g)i.addRing(e.a,e.n,0,e.arc/t.roadTileLength,e.b,e.n,1,e.arc/t.roadTileLength);for(let[e]of _)a.addRing(e.a,e.n,0,e.arc/t.shoulderTileLength,e.b,e.n,1,e.arc/t.shoulderTileLength);a.beginStrip();for(let[,e]of _)a.addRing(e.a,e.n,0,e.arc/t.shoulderTileLength,e.b,e.n,1,e.arc/t.shoulderTileLength);this.buildWalls(s,v),this.buildSkirt(c,v);for(let[e]of v)l.addRing(e.a,e.n,0,0,e.b,e.n,1,0);l.beginStrip();for(let[,e]of v)l.addRing(e.a,e.n,0,0,e.b,e.n,1,0);let te=Bn();this.road=Ln(i,new S({map:te.asphalt,roughness:.92,metalness:0})),this.road.receiveShadow=!0,this.shoulders=Ln(a,new S({map:te.curb,roughness:.7})),this.shoulders.receiveShadow=!0,this.walls=Ln(s,new S({color:`#eceff5`,roughness:.75})),this.walls.castShadow=!0,this.walls.receiveShadow=!0,this.skirt=Ln(c,new S({color:`#4a4f5a`,roughness:1})),this.group.add(this.road,this.shoulders,this.walls,this.skirt),this.collision=Rn([i,a,l])}get halfWidth(){return he(this.cfg)}buildWalls(e,t){let n=this.cfg.wallHeight,r=new o(0,1,0),i=e=>e.clone().addScaledVector(r,n),a=[([,e])=>[e.a,i(e.a)],([,e])=>[i(e.a),i(e.b)],([,e])=>[i(e.b),e.b],([e])=>[i(e.a),e.a],([e])=>[i(e.b),i(e.a)],([e])=>[e.b,i(e.b)]];for(let n=0;n<a.length;n++){n>0&&e.beginStrip();let r=a[n],i=n<3;for(let n of t){let[t,a]=r(n),o=i?n[1]:n[0],s=Fn(t,a,o.tan),c=o.arc/this.cfg.shoulderTileLength;e.addRing(t,s,0,c,a,s,1,c)}}}buildSkirt(e,t){let n=this.cfg.skirtBottomY,r=e=>new o(e.x,n,e.z);for(let[,n]of t){let t=Fn(n.b,r(n.b),n.tan);e.addRing(n.b,t,0,n.arc/10,r(n.b),t,1,n.arc/10)}e.beginStrip();for(let[n]of t){let t=Fn(r(n.b),n.b,n.tan);e.addRing(r(n.b),t,0,n.arc/10,n.b,t,1,n.arc/10)}}};function Fn(e,t,n){let r=new o().subVectors(t,e).cross(n).normalize();return r.lengthSq()>.5?r:new o(0,1,0)}var In=class{position=[];normal=[];uv=[];index=[];ringCount=0;base=0;beginStrip(){this.base=this.position.length/3,this.ringCount=0}addRing(e,t,n,r,i,a,o,s){if(this.position.push(e.x,e.y,e.z,i.x,i.y,i.z),this.normal.push(t.x,t.y,t.z,a.x,a.y,a.z),this.uv.push(n,r,o,s),this.ringCount>0){let e=this.base+(this.ringCount-1)*2;this.index.push(e,e+1,e+2,e+1,e+3,e+2)}this.ringCount++}toGeometry(){let e=new ue;return e.setAttribute(`position`,new f(this.position,3)),e.setAttribute(`normal`,new f(this.normal,3)),e.setAttribute(`uv`,new f(this.uv,2)),e.setIndex(this.index),e.computeBoundingSphere(),e}};function Ln(e,n){return new t(e.toGeometry(),n)}function Rn(e){let t=[],n=[];for(let r of e){let e=t.length/3;t.push(...r.position);for(let t of r.index)n.push(t+e)}return{vertices:new Float32Array(t),indices:new Uint32Array(n)}}function zn(e,t=600,n=.12){let i=[];for(let r=0;r<=t;r++){let a=e.getPointAt(r/t);i.push(new o(a.x,a.y+n,a.z))}let a=new ue().setFromPoints(i),s=new me(a,new r({color:`#ff2fd0`}));return s.frustumCulled=!1,s}function Bn(){let e=new _(Vn());e.wrapS=e.wrapT=fe,e.anisotropy=8,e.colorSpace=w;let t=new _(Hn());return t.wrapS=t.wrapT=fe,t.anisotropy=8,t.colorSpace=w,{asphalt:e,curb:t}}function Vn(){let e=document.createElement(`canvas`);e.width=256,e.height=256;let t=e.getContext(`2d`);t.fillStyle=`#3b3f46`,t.fillRect(0,0,256,256);for(let e=0;e<2600;e++){let e=40+Math.random()*45;t.fillStyle=`rgb(${e},${e+2},${e+6})`,t.fillRect(Math.random()*256,Math.random()*256,2,2)}t.fillStyle=`#f2f4f8`,t.fillRect(6,0,5,256),t.fillRect(245,0,5,256);for(let e=0;e<256;e+=64)t.fillRect(126,e,4,34);return e}function Hn(){let e=document.createElement(`canvas`);e.width=e.height=64;let t=e.getContext(`2d`);return t.fillStyle=`#f5f5f7`,t.fillRect(0,0,64,64),t.fillStyle=`#e0362f`,t.fillRect(0,0,64,32),e}var Un=new o(0,1,0),Wn=class{curve;length;sampleCount;px;py;pz;rx;rz;tmpA=new o;tmpB=new o;tmpCenter=new o;constructor(e,t=ge.lutSamples){this.curve=new ee(e.map(([e,t,n])=>new o(e,t,n)),!0,`catmullrom`,.5),this.length=this.curve.getLength(),this.sampleCount=t,this.px=new Float64Array(t),this.py=new Float64Array(t),this.pz=new Float64Array(t),this.rx=new Float64Array(t),this.rz=new Float64Array(t);let n=new o,r=new o;for(let e=0;e<t;e++){let i=e/t;this.curve.getPointAt(i,n),this.curve.getTangentAt(i,r),this.px[e]=n.x,this.py[e]=n.y,this.pz[e]=n.z;let a=Math.hypot(r.x,r.z)||1;this.rx[e]=-r.z/a,this.rz[e]=r.x/a}}getPointAt(e,t=new o){return this.curve.getPointAt(Gn(e),t)}getTangentAt(e,t=new o){return this.curve.getTangentAt(Gn(e),t).normalize()}getNormalAt(e,t=new o){let n=this.getTangentAt(e,this.tmpA),r=this.tmpB.copy(n).cross(Un).normalize();return t.copy(r).cross(n).normalize()}getSideAt(e,t=new o){let n=this.getTangentAt(e,this.tmpA);return t.copy(n).cross(Un).normalize()}getHeadingAt(e){let t=this.getTangentAt(e,this.tmpA);return Math.atan2(t.x,t.z)}getProgress(e,t,n){let r=this.sampleCount,i=0,a=1/0;for(let n=0;n<r;n++){let r=e-this.px[n],o=t-this.pz[n],s=r*r+o*o;s<a&&(a=s,i=n)}let o=(i-1+r)%r,s=(i+1)%r,c=this.projectOnSegment(o,i,e,t),l=this.projectOnSegment(i,s,e,t),u=c.d2<=l.d2?c:l,d=Gn(u.index/r+u.u/r),f=this.getPointAt(d,this.tmpCenter),p=this.getHeadingAt(d),m=Math.sin(p-Math.PI/2),h=Math.cos(p-Math.PI/2),g=(e-f.x)*m+(t-f.z)*h,_=n??{};return _.t=d,_.lateral=g,_.centerX=f.x,_.centerY=f.y,_.centerZ=f.z,_.heading=p,_}projectOnSegment(e,t,n,r){let i=this.px[e],a=this.pz[e],o=this.px[t]-i,s=this.pz[t]-a,c=o*o+s*s,l=c>1e-9?Kn(((n-i)*o+(r-a)*s)/c):0,u=n-(i+o*l),d=r-(a+s*l);return{index:e,u:l,d2:u*u+d*d}}};function Gn(e){let t=e%1;return t<0?t+1:t}var Kn=e=>e<0?0:e>1?1:e;function qn(){return{x:0,z:0,heading:0}}function Jn(e){let t=e%1;return t<0?t+1:t}function Yn(e){let t=(e+Math.PI)%(2*Math.PI);return(t<0?t+2*Math.PI:t)-Math.PI}function Xn(e,t){if(t===0)return e;let n=e.heading-Math.PI/2;return e.x+=Math.sin(n)*t,e.z+=Math.cos(n)*t,e}function Zn(e){let t=e>>>0;return{next(){t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}}function Qn(e,t,n){return t+e.next()*(n-t)}function $n(e,t){let n=0;for(let[,t]of e)t>0&&(n+=t);if(n<=0)return null;let r=t.next()*n;for(let[t,n]of e)if(!(n<=0)&&(r-=n,r<0))return t;for(let t=e.length-1;t>=0;t--)if(e[t][1]>0)return e[t][0];return null}var er={lookAheadDistance:18,lookAheadPerSpeed:.34,laneOffset:0,steerGain:2,liftAngle:.22,fullLiftAngle:.72,minThrottle:.55,brakeAngle:1,brakeSpeed:18,useDrift:!0,driftAngleThreshold:.4,driftReleaseAngle:.2,driftMinSpeed:14,driftMinHold:.75,driftMaxHold:2.6,stuckSpeed:.8,stuckTime:1.5,reverseTime:.8,itemDelayMin:.5,itemDelayMax:2,itemHoldPatience:6},tr=(e,t,n)=>e<t?t:e>n?n:e,nr=(e,t,n)=>e+(t-e)*n,rr=.5,ir=class{track;config;out={...Gt};point=qn();driftHold=0;stuckTimer=0;reverseTimer=0;itemDelay=null;itemHeld=0;rng;_angleError=0;_target=qn();constructor(e,t={},n=1){this.track=e,this.config={...er,...t},this.rng=Zn(n)}reset(){this.driftHold=0,this.stuckTimer=0,this.reverseTimer=0,this.itemDelay=null,this.itemHeld=0,this._angleError=0,this.out.steer=0,this.out.throttle=0,this.out.brake=0,this.out.drift=!1,this.out.useItem=!1}update(e,t,n,r){let i=this.config,a=this.out,o=Jn(t+(i.lookAheadDistance+i.lookAheadPerSpeed*Math.max(e.speed,0))/Math.max(this.track.length,1e-6)),s=Xn(this.track.sampleAt(o,this.point),i.laneOffset);this._target.x=s.x,this._target.z=s.z,this._target.heading=s.heading;let c=s.x-e.x,l=s.z-e.z,u=Yn((Math.hypot(c,l)<rr?s.heading:Math.atan2(c,l))-e.heading),d=Math.abs(u);this._angleError=u,Math.abs(e.speed)<i.stuckSpeed&&!e.airborne?this.stuckTimer+=n:this.stuckTimer=0;let f=!1;this.reverseTimer>0?(this.reverseTimer=Math.max(0,this.reverseTimer-n),f=!0):this.stuckTimer>=i.stuckTime&&(this.reverseTimer=i.reverseTime,this.stuckTimer=0,f=!0);let p=tr(-u*i.steerGain,-1,1);f&&(p=-p);let m,h;if(f)m=0,h=1;else{let t=Math.max(i.fullLiftAngle-i.liftAngle,1e-6),n=tr((d-i.liftAngle)/t,0,1);m=nr(1,i.minThrottle,n),h=+(d>=i.brakeAngle&&e.speed>i.brakeSpeed),h>0&&(m=0)}let g=!1;if(i.useDrift&&!f){if(this.driftHold>0){this.driftHold+=n;let t=this.driftHold>=i.driftMaxHold,r=this.driftHold>=i.driftMinHold&&d<i.driftReleaseAngle,a=e.speed<i.driftMinSpeed;t||r||a?this.driftHold=0:g=!0}else d>=i.driftAngleThreshold&&e.speed>=i.driftMinSpeed&&(this.driftHold=n,g=!0)}else this.driftHold=0;return a.steer=p,a.throttle=m,a.brake=h,a.drift=g,a.useItem=this.decideItem(r,n),a}decideItem(e,t){return e?.hasItem?(this.itemDelay===null&&(this.itemDelay=Qn(this.rng,this.config.itemDelayMin,this.config.itemDelayMax),this.itemHeld=0),this.itemHeld+=t,this.itemDelay-=t,this.itemDelay>0||e.offensive&&!e.targetAhead&&this.itemHeld<this.config.itemHoldPatience?!1:(this.itemDelay=null,this.itemHeld=0,!0)):(this.itemDelay=null,this.itemHeld=0,!1)}get angleError(){return this._angleError}get target(){return this._target}get drifting(){return this.driftHold>0}},ar={behindRange:.09,aheadRange:.07,maxMultiplier:1.1,minMultiplier:.88,smoothing:.8},or={behindRange:1,aheadRange:1,maxMultiplier:1,minMultiplier:1,smoothing:1},sr=e=>e<0?0:e>1?1:e;function cr(e,t){if(!Number.isFinite(e))return 1;if(e<0){let n=sr(-e/Math.max(t.behindRange,1e-6));return 1+(t.maxMultiplier-1)*n}let n=sr(e/Math.max(t.aheadRange,1e-6));return 1-(1-t.minMultiplier)*n}var lr=class{config;_multiplier=1;constructor(e={}){this.config={...ar,...e}}update(e,t){let n=cr(e,this.config);return t>0&&(this._multiplier+=(n-this._multiplier)*(1-Math.exp(-this.config.smoothing*t))),this._multiplier}get multiplier(){return this._multiplier}reset(){this._multiplier=1}},ur=Object.keys(an),dr=Object.keys(on),fr=class{id;persona;driver;rubberband=new lr;config=cn();current;previous;_wantsItem=!1;_difficulty;speedMul=1;_rubberbandEnabled=!0;constructor(e,t){this.id=e.id,this.persona=e.persona,this._difficulty=e.difficulty,this.driver=new ir(e.track,{...ht[e.difficulty].driver,laneOffset:e.persona.laneOffset},e.seed??1),this.applyDifficulty(e.difficulty),this.current=dn(t.x,t.z,t.heading,t.y??0),this.previous={...this.current}}get difficulty(){return this._difficulty}setDifficulty(e){this._difficulty=e,this.applyDifficulty(e)}applyDifficulty(e){let t=ht[e];Object.assign(this.driver.config,t.driver),this.driver.config.laneOffset=this.persona.laneOffset,this.speedMul=t.speedMul*this.persona.speedMul,this.rubberband.config=this._rubberbandEnabled?t.rubberband:or}get rubberbandEnabled(){return this._rubberbandEnabled}set rubberbandEnabled(e){this._rubberbandEnabled=e,this.rubberband.config=e?ht[this._difficulty].rubberband:or,e||this.rubberband.reset()}respawn(e){this.current=dn(e.x,e.z,e.heading,e.y??0),this.previous={...this.current},this.driver.reset(),this.rubberband.reset()}step(e,t,n,r,i,a,o){this.previous=this.current,this.rubberband.update(r-this.persona.targetGap,i),this.syncConfig(e);let s=Gt;n?this.driver.reset():s=this.driver.update(this.current,t.progress,i,a),this._wantsItem=s.useItem,o?.applyTo(this.config),this.current=yn(this.current,s,t,this.config,i)}syncConfig(e){let t=this.config;for(let n of ur)t[n]=e[n];for(let n of dr){let r=e[n],i=t[n];i[0]=r[0],i[1]=r[1],i[2]=r[2]}t.maxSpeed=e.maxSpeed*this.speedMul*this.rubberband.multiplier}get wantsItem(){return this._wantsItem}get baseSpeedMul(){return this.speedMul}get effectiveSpeedMul(){return this.speedMul*this.rubberband.multiplier}};function pr(e){let t=e.getPointAt(0),n=e.getProgress(0,0);return{length:e.length,progressAt(t,r){return e.getProgress(t,r,n).t},sampleAt(n,r){return e.getPointAt(n,t),r.x=t.x,r.z=t.z,r.heading=e.getHeadingAt(n),r}}}function mr(){return{x:0,y:0,z:0,vx:0,vy:0,vz:0,jitter:0,spread:0,color:new x(1,1,1),size:.4,endSize:.4,life:.4,groundY:0}}var hr=class{points;capacity;position;color;sizeAttr;alphaAttr;velocity;baseColor;life;maxLife;size0;size1;groundY;gravity;drag;clampToGround;cursor=0;live=0;dirty=!1;constructor(e){let t=this.capacity=Math.max(1,Math.floor(e.capacity));this.gravity=e.gravity??14,this.drag=e.drag??0,this.clampToGround=e.clampToGround??!1,this.position=new Float32Array(t*3),this.color=new Float32Array(t*3),this.baseColor=new Float32Array(t*3),this.velocity=new Float32Array(t*3),this.sizeAttr=new Float32Array(t),this.alphaAttr=new Float32Array(t),this.life=new Float32Array(t),this.maxLife=new Float32Array(t),this.size0=new Float32Array(t),this.size1=new Float32Array(t),this.groundY=new Float32Array(t);let n=new ue;n.setAttribute(`position`,new b(this.position,3)),n.setAttribute(`color`,new b(this.color,3)),n.setAttribute(`aSize`,new b(this.sizeAttr,1)),n.setAttribute(`aAlpha`,new b(this.alphaAttr,1)),n.boundingSphere=new pe(new o,1e6);let r=new C({uniforms:re.merge([ae.fog,{uTexture:{value:null},uScale:{value:300}}]),vertexShader:gr,fragmentShader:_r,transparent:!0,vertexColors:!0,depthWrite:!1,depthTest:!0,blending:e.additive===!1?1:2,fog:!0});r.uniforms.uTexture.value=vr(e.shape??`spark`),this.points=new oe(n,r),this.points.frustumCulled=!1,this.points.renderOrder=2}get activeCount(){return this.live}setViewportHeight(e){this.points.material.uniforms.uScale.value=e*.5}spawn(e){let t=this.cursor;this.cursor=(this.cursor+1)%this.capacity,this.life[t]<=0&&this.live++;let n=t*3;this.position[n]=e.x+(Math.random()-.5)*e.jitter,this.position[n+1]=e.y+(Math.random()-.5)*e.jitter,this.position[n+2]=e.z+(Math.random()-.5)*e.jitter,this.velocity[n]=e.vx+(Math.random()-.5)*e.spread,this.velocity[n+1]=e.vy+(Math.random()-.5)*e.spread,this.velocity[n+2]=e.vz+(Math.random()-.5)*e.spread,this.baseColor[n]=e.color.r,this.baseColor[n+1]=e.color.g,this.baseColor[n+2]=e.color.b,this.color[n]=e.color.r,this.color[n+1]=e.color.g,this.color[n+2]=e.color.b,this.size0[t]=e.size,this.size1[t]=e.endSize,this.sizeAttr[t]=e.size,this.alphaAttr[t]=1,this.life[t]=e.life,this.maxLife[t]=e.life,this.groundY[t]=e.groundY,this.dirty=!0}step(e){if(e<=0||this.live===0){this.flush();return}let t=this.drag>0?Math.exp(-this.drag*e):1,n=0;for(let r=0;r<this.capacity;r++){let i=this.life[r];if(i<=0)continue;let a=i-e,o=r*3;if(a<=0){this.life[r]=0,this.alphaAttr[r]=0;continue}n++,this.life[r]=a;let s=this.velocity[o+1]-this.gravity*e,c=this.velocity[o],l=this.velocity[o+2];if(t!==1&&(c*=t,s*=t,l*=t),this.velocity[o]=c,this.velocity[o+1]=s,this.velocity[o+2]=l,this.position[o]=this.position[o]+c*e,this.position[o+1]=this.position[o+1]+s*e,this.position[o+2]=this.position[o+2]+l*e,this.clampToGround){let e=this.groundY[r]+.02;this.position[o+1]<e&&(this.position[o+1]=e,this.velocity[o+1]=0)}let u=a/this.maxLife[r];this.sizeAttr[r]=this.size1[r]+(this.size0[r]-this.size1[r])*u;let d=1-u;this.alphaAttr[r]=u*(d<.15?d/.15:1)}this.live=n,this.dirty=!0,this.flush()}flush(){if(!this.dirty)return;this.dirty=!1;let e=this.points.geometry.attributes;e.position.needsUpdate=!0,e.color.needsUpdate=!0,e.aSize.needsUpdate=!0,e.aAlpha.needsUpdate=!0}clear(){this.life.fill(0),this.alphaAttr.fill(0),this.live=0,this.dirty=!0,this.flush()}dispose(){this.points.geometry.dispose();let e=this.points.material;e.uniforms.uTexture.value.dispose(),e.dispose()}},gr=`
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;

  #include <fog_pars_vertex>

  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(aSize * uScale * projectionMatrix[1][1] / -mvPosition.z, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`,_r=`
  uniform sampler2D uTexture;
  varying vec3 vColor;
  varying float vAlpha;

  #include <fog_pars_fragment>

  void main() {
    vec4 tex = texture2D(uTexture, gl_PointCoord);
    float alpha = tex.a * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * tex.rgb, alpha);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;function vr(e){let t=document.createElement(`canvas`);t.width=t.height=64;let n=t.getContext(`2d`),r=n.createRadialGradient(32,32,0,32,32,32);e===`spark`?(r.addColorStop(0,`rgba(255,255,255,1)`),r.addColorStop(.25,`rgba(255,255,255,0.95)`),r.addColorStop(.6,`rgba(255,255,255,0.35)`)):(r.addColorStop(0,`rgba(255,255,255,0.5)`),r.addColorStop(.45,`rgba(255,255,255,0.26)`)),r.addColorStop(1,`rgba(255,255,255,0)`),n.fillStyle=r,n.fillRect(0,0,64,64);let i=new _(t);return i.colorSpace=w,i}var yr=class e{static LEVEL_COLORS=[new x(`#fff6e0`),new x(`#ff9a2b`),new x(`#3fa9ff`)];static DEFAULT_CAPACITY=400;static LIFE=.38;static RATE=110;pool;spawn=mr();accumulator=0;constructor(t=e.DEFAULT_CAPACITY){this.pool=new hr({capacity:t,gravity:14,additive:!0,shape:`spark`,clampToGround:!0})}get points(){return this.pool.points}get capacity(){return this.pool.capacity}get activeCount(){return this.pool.activeCount}emit(t,n,r,i=0){if(r<=0||n<=0||t.length===0)return;this.accumulator+=e.RATE*t.length*r;let a=Math.floor(this.accumulator);this.accumulator-=a;let o=this.spawn;o.color=e.LEVEL_COLORS[n-1],o.jitter=.18,o.spread=1.2,o.life=e.LIFE,o.size=.34,o.endSize=.08,o.groundY=i;for(let e=0;e<a;e++){let n=t[e%t.length];o.x=n.x,o.y=Math.max(i+.05,n.y-.18),o.z=n.z;let r=Math.random()*Math.PI*2,a=1.6+Math.random()*3.4;o.vx=Math.cos(r)*a*.6,o.vy=1.8+Math.random()*3.2,o.vz=Math.sin(r)*a*.6,this.pool.spawn(o)}}step(e){this.pool.step(e)}setViewportHeight(e){this.pool.setViewportHeight(e)}clear(){this.pool.clear(),this.accumulator=0}dispose(){this.pool.dispose()}},br=class e{static LIFE=.75;static RATE=26;static ROAD_COLOR=new x(`#d8d2c4`);static OFFROAD_COLOR=new x(`#c2a874`);pool;spawn=mr();accumulator=0;constructor(e){this.pool=new hr({capacity:e,gravity:-1.2,drag:2.2,additive:!1,shape:`smoke`})}get points(){return this.pool.points}get activeCount(){return this.pool.activeCount}emit(t,n,r,i,a){if(r<=0||n<=.01||t.length===0)return;this.accumulator+=e.RATE*t.length*n*r;let o=Math.floor(this.accumulator);this.accumulator-=o;let s=this.spawn;s.color=a?e.OFFROAD_COLOR:e.ROAD_COLOR,s.jitter=.3,s.spread=.9,s.life=e.LIFE*(.7+.6*n),s.size=.5,s.endSize=1.5,s.groundY=i;for(let e=0;e<o;e++){let n=t[e%t.length];s.x=n.x,s.y=i+.12,s.z=n.z,s.vx=(Math.random()-.5)*1.4,s.vy=.6+Math.random()*.9,s.vz=(Math.random()-.5)*1.4,this.pool.spawn(s)}}step(e){this.pool.step(e)}setViewportHeight(e){this.pool.setViewportHeight(e)}clear(){this.pool.clear(),this.accumulator=0}dispose(){this.pool.dispose()}},xr=class e{static FLASH_LIFE=.18;static SHARD_LIFE=.5;pool;spawn=mr();color=new x;constructor(e){this.pool=new hr({capacity:e,gravity:6,drag:1.6,additive:!0,shape:`spark`})}get points(){return this.pool.points}get activeCount(){return this.pool.activeCount}burst(t,n,r,i,a=1,o=26){this.color.set(i);let s=this.spawn;s.color=this.color,s.groundY=n-1,s.x=t,s.y=n,s.z=r,s.vx=s.vy=s.vz=0,s.jitter=0,s.spread=0,s.size=2.2*a,s.endSize=5.5*a,s.life=e.FLASH_LIFE,this.pool.spawn(s),s.jitter=.25,s.spread=1.5*a,s.size=.55*a,s.endSize=.1,s.life=e.SHARD_LIFE;for(let e=0;e<o;e++){let e=Math.random()*Math.PI*2,t=Math.random()*1.4-.4,n=Math.sqrt(Math.max(0,1-t*t)),r=(5+Math.random()*7)*a;s.vx=Math.cos(e)*n*r,s.vy=t*r,s.vz=Math.sin(e)*n*r,this.pool.spawn(s)}}step(e){this.pool.step(e)}setViewportHeight(e){this.pool.setViewportHeight(e)}clear(){this.pool.clear()}dispose(){this.pool.dispose()}},Sr=class e{mesh;static SEGMENTS=16;static WIDTH=.85;count;position;color;alpha;history;strength;historyValid;tint=new x;constructor(n){this.count=Math.max(1,n);let r=e.SEGMENTS,i=this.count*r*2;this.position=new Float32Array(i*3),this.color=new Float32Array(i*3),this.alpha=new Float32Array(i),this.history=new Float32Array(this.count*r*5),this.strength=new Float32Array(this.count),this.historyValid=new Uint8Array(this.count);let a=new ue;a.setAttribute(`position`,new b(this.position,3)),a.setAttribute(`color`,new b(this.color,3)),a.setAttribute(`aAlpha`,new b(this.alpha,1));let s=[];for(let e=0;e<this.count;e++){let t=e*r*2;for(let e=0;e<r-1;e++){let n=t+e*2;s.push(n,n+1,n+2,n+1,n+3,n+2)}}a.setIndex(s),a.boundingSphere=new pe(new o,1e6),this.mesh=new t(a,new C({vertexShader:wr,fragmentShader:Tr,transparent:!0,vertexColors:!0,depthWrite:!1,side:2,blending:2})),this.mesh.frustumCulled=!1,this.mesh.renderOrder=2}push(t,n,r,i,a,o,s,c){if(t<0||t>=this.count)return;let l=e.SEGMENTS,u=Math.max(0,Math.min(o,1)),d=u>this.strength[t]?26:5;this.strength[t]=Cr(this.strength[t],u,1-Math.exp(-d*c));let f=Math.cos(a),p=-Math.sin(a),m=t*l*5;if(this.historyValid[t])this.history.copyWithin(m+5,m,m+(l-1)*5),this.history[m]=n,this.history[m+1]=r,this.history[m+2]=i,this.history[m+3]=f,this.history[m+4]=p;else{for(let e=0;e<l;e++){let t=m+e*5;this.history[t]=n,this.history[t+1]=r,this.history[t+2]=i,this.history[t+3]=f,this.history[t+4]=p}this.historyValid[t]=1}this.tint.set(s);let h=this.strength[t],g=t*l*2;for(let t=0;t<l;t++){let n=m+t*5,r=this.history[n],i=this.history[n+1],a=this.history[n+2],o=e.WIDTH/2*h*(1-t/l),s=this.history[n+3]*o,c=this.history[n+4]*o,u=(g+t*2)*3;this.position[u]=r-s,this.position[u+1]=i,this.position[u+2]=a-c,this.position[u+3]=r+s,this.position[u+4]=i,this.position[u+5]=a+c;for(let e=0;e<2;e++){let n=u+e*3;this.color[n]=this.tint.r,this.color[n+1]=this.tint.g,this.color[n+2]=this.tint.b,this.alpha[g+t*2+e]=h*(1-t/l)**2}}}flush(){let e=this.mesh.geometry.attributes;e.position.needsUpdate=!0,e.color.needsUpdate=!0,e.aAlpha.needsUpdate=!0}setVisible(e){this.mesh.visible=e}clear(){this.historyValid.fill(0),this.strength.fill(0),this.alpha.fill(0),this.flush()}dispose(){this.mesh.geometry.dispose(),this.mesh.material.dispose()}},Cr=(e,t,n)=>e+(t-e)*n,wr=`
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,Tr=`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor, vAlpha);
    #include <colorspace_fragment>
  }
`,Er={baseDistance:7.5,distanceGain:3.2,baseHeight:3.6,heightGain:-.9,lookAhead:7,lookHeight:1.4,stiffness:90,damping:1,baseFov:62,fovGain:22,fovSmoothing:4,punchFov:10,punchDecay:3.2,driftSideOffset:1.5,shakeAmount:.16,shakeDecay:7,shakeFrequency:22},Dr={baseDistance:[2,25,.1],distanceGain:[0,20,.1],baseHeight:[.5,15,.1],heightGain:[-5,8,.1],lookAhead:[0,30,.1],lookHeight:[0,6,.1],stiffness:[5,400,1],damping:[.3,2,.01],baseFov:[30,100,1],fovGain:[0,60,1],fovSmoothing:[.5,20,.1],punchFov:[0,40,.5],punchDecay:[.5,12,.1],driftSideOffset:[0,6,.05],shakeAmount:[0,1,.01],shakeDecay:[1,20,.5],shakeFrequency:[4,50,.5]},Or=(e,t,n)=>e<t?t:e>n?n:e,kr=(e,t,n)=>e+(t-e)*n,Ar=1/90,jr=class{camera;config={...Er};position=new o;velocity=new o;desired=new o;lookTarget=new o;smoothedLook=new o;tmp=new o;fov=Er.baseFov;floorY=0;fovPunch=0;shakeMag=0;shakePhase=0;driftSide=0;shakeOffset=new o;lastFrameDt=1/60;constructor(e){this.camera=new de(this.config.baseFov,e,.1,1200)}resize(e){this.camera.aspect=e,this.camera.updateProjectionMatrix()}snapTo(e,t){this.computeDesired(e,t),this.position.copy(this.desired),this.velocity.set(0,0,0),this.smoothedLook.copy(this.lookTarget),this.fov=this.config.baseFov,this.fovPunch=0,this.shakeMag=0,this.driftSide=0,this.shakeOffset.set(0,0,0),this.applyToCamera()}update(e,t,n){this.lastFrameDt=n,this.computeDesired(e,t);let r=2*Math.sqrt(this.config.stiffness)*this.config.damping,i=Math.min(n,.25);for(;i>0;){let e=Math.min(i,Ar);this.tmp.copy(this.desired).sub(this.position).multiplyScalar(this.config.stiffness),this.tmp.addScaledVector(this.velocity,-r),this.velocity.addScaledVector(this.tmp,e),this.position.addScaledVector(this.velocity,e),i-=e}let a=1-Math.exp(-10*n);this.smoothedLook.lerp(this.lookTarget,a);let o=Or(Math.abs(e.speed)/Math.max(t.maxSpeed,.001),0,1),s=this.config.baseFov+this.config.fovGain*o;this.fov=kr(this.fov,s,1-Math.exp(-this.config.fovSmoothing*n)),this.fovPunch*=Math.exp(-this.config.punchDecay*n),this.fovPunch<.01&&(this.fovPunch=0),this.updateShake(n),this.applyToCamera()}computeDesired(e,t){let n=Or(Math.abs(e.speed)/Math.max(t.maxSpeed,.001),0,1),r=Math.sin(e.heading),i=Math.cos(e.heading),a=this.config.baseDistance+this.config.distanceGain*n,o=e.y+Math.max(.5,this.config.baseHeight+this.config.heightGain*n);this.floorY=e.y;let s=Math.sqrt(Math.max(this.config.stiffness,.001)),c=2*this.config.damping/s,l=r*e.speed*c,u=i*e.speed*c,d=e.driftPhase===`drifting`?-e.driftDir*this.config.driftSideOffset*(.4+.6*n):0;this.driftSide=kr(this.driftSide,d,1-Math.exp(-6*this.lastFrameDt));let f=Math.cos(e.heading)*this.driftSide,p=-Math.sin(e.heading)*this.driftSide;this.desired.set(e.x-r*a+l+f,o,e.z-i*a+u+p),this.lookTarget.set(e.x+r*this.config.lookAhead,e.y+this.config.lookHeight,e.z+i*this.config.lookAhead)}punch(e=this.config.punchFov){this.fovPunch=Math.max(this.fovPunch,e)}shake(e=1){this.shakeMag=Math.max(this.shakeMag,Or(e,0,1)*this.config.shakeAmount)}get currentShake(){return this.shakeMag}updateShake(e){if(this.shakeMag<=1e-4){this.shakeMag=0,this.shakeOffset.set(0,0,0);return}this.shakePhase+=e*this.config.shakeFrequency,this.shakeMag*=Math.exp(-this.config.shakeDecay*e),this.shakeOffset.set(Math.sin(this.shakePhase*6.283)*this.shakeMag,Math.sin(this.shakePhase*9.156+1.7)*this.shakeMag*.7,Math.sin(this.shakePhase*7.541+3.1)*this.shakeMag)}get currentFov(){return this.fov+this.fovPunch}applyToCamera(){this.camera.position.set(this.position.x+this.shakeOffset.x,Math.max(this.position.y,this.floorY+.4)+this.shakeOffset.y,this.position.z+this.shakeOffset.z),this.camera.lookAt(this.smoothedLook);let e=this.fov+this.fovPunch;Math.abs(this.camera.fov-e)>1e-4&&(this.camera.fov=e,this.camera.updateProjectionMatrix())}},Mr=/wheel|轮/i,Nr=/front|_f[lr]?\b|\bf[lr]\b|前/i,Pr=/rear|back|_r[lr]?\b|\br[lr]\b|后/i;function Fr(e,t){let n=new c;n.add(t),e.add(n),e.updateMatrixWorld(!0);let r=[];t.traverse(e=>{Mr.test(e.name)&&(r.some(t=>Lr(t,e))||r.push(e))});let i=[],a=0,s=new ce,l=new o,u=new o;for(let t of r){t.getWorldPosition(u),s.setFromObject(t),s.getSize(l),a+=Math.max(l.y,l.z)/2;let n=new c;n.position.copy(u),e.add(n),n.attach(t),t.position.set(0,0,0),i.push({pivot:n,front:Ir(t.name,u.z),left:u.x<0})}return i.length===0&&console.warn(`[kartRig] 模型里没找到名字带 "wheel" 的节点，轮子不会转也不会打方向。导出时把四个轮子的节点名改成 Wheel_FL / Wheel_FR / Wheel_RL / Wheel_RR。`),{chassis:n,wheels:i,wheelRadius:i.length>0?a/i.length:null}}function Ir(e,t){return Nr.test(e)?!0:!Pr.test(e)&&t>0}function Lr(e,t){for(let n=t.parent;n;n=n.parent)if(n===e)return!0;return!1}var Rr=[`body`,`accent`,`trim`,`suit`],zr=new class{cache=new Map;get(e,t){let n=`${e.uuid}|${t}`,r=this.cache.get(n);if(r)return r;let i=e.clone(),a=i;return a.color&&a.color.set(t),i.name=`${e.name||`mat`}#${t}`,this.cache.set(n,i),i}get size(){return this.cache.size}dispose(){for(let e of this.cache.values())e.dispose();this.cache.clear()}};function Br(e,t,n=zr){let r=0;return e.traverse(e=>{let i=e;if(!i.isMesh)return;let a=(Array.isArray(i.material)?i.material:[i.material]).map(e=>{let i=Vr(e.name);return i?(r++,n.get(e,t[i])):e});i.material=Array.isArray(i.material)?a:a[0]}),r}function Vr(e){let t=e.toLowerCase();for(let e of Rr)if(t.includes(e))return e;return null}var Hr={maxRoll:.16,maxPitch:.07,leanSmoothing:9,steerVisualAngle:.5,wheelRadius:.36,driftRollMul:2.1,driftRollBias:.1},Ur={maxRoll:[0,.6,.005],maxPitch:[0,.4,.005],leanSmoothing:[1,30,.5],steerVisualAngle:[0,1.2,.01],wheelRadius:[.1,1,.01],driftRollMul:[1,5,.05],driftRollBias:[0,.5,.01]},Wr=(e,t,n)=>e+(t-e)*n,Gr=(e,t,n)=>e<t?t:e>n?n:e,Kr={body:`#ff3b30`,accent:`#ffcc00`,trim:`#f7f7fa`,suit:`#2f6fed`},qr=new o(0,1,0),Jr=new o,Yr=new ne,Xr=new ne,Zr=class{root=new c;config={...Hr};palette;chassis;frontPivots=[];rearPivots=[];allWheels=[];ownedGeometries=[];usingModel=!1;roll=0;pitch=0;wheelSpin=0;lastSpeed=0;smoothedAccel=0;get bodyRoll(){return this.roll}get frontWheelAngle(){return this.frontPivots[0]?.rotation.y??0}get hasModel(){return this.usingModel}ghost;ghostOpacity;constructor(e={},t={}){this.palette={...Kr,...e},this.ghost=t.ghost??!1,this.ghostOpacity=t.ghostOpacity??.34,this.buildPlaceholder()}setModel(e){if(this.teardown(),!e){this.buildPlaceholder();return}Br(e,this.palette),this.ghost&&ci(e,this.ghostOpacity),e.traverse(e=>{let t=e;t.isMesh&&(t.castShadow=!this.ghost,t.receiveShadow=!this.ghost)});let t=Fr(this.root,e);this.chassis=t.chassis;for(let e of t.wheels)(e.front?this.frontPivots:this.rearPivots).push(e.pivot),this.allWheels.push(e.pivot.children[0]??e.pivot);t.wheelRadius&&t.wheelRadius>.05&&(this.config.wheelRadius=t.wheelRadius),this.usingModel=!0}teardown(){this.root.clear();for(let e of this.ownedGeometries)e.dispose();this.ownedGeometries=[],this.frontPivots=[],this.rearPivots=[],this.allWheels=[],this.usingModel=!1,this.roll=0,this.pitch=0}buildPlaceholder(){this.chassis=new c,this.root.add(this.chassis),this.buildChassis(),this.buildWheels()}buildChassis(){let e=this.palette,n=[[D(1.24,.22,2.1,0,.34,0),e.body],[D(.22,.3,1.4,-.76,.36,.05),e.trim],[D(.22,.3,1.4,.76,.36,.05),e.trim],[D(.95,.2,.7,0,.36,1.32),e.accent],[D(.86,.62,.16,0,.72,-.58),e.suit],[D(1.3,.08,.34,0,1.14,-1.16),e.accent],[D(.5,.5,.34,0,.78,-.28),e.suit],[D(.4,.22,.4,0,1.3,-.3),e.body]],r=[[D(.9,.12,.9,0,.45,-.05),$r],[D(.7,.44,.5,0,.6,-1),$r],[D(.12,.34,.1,-.5,.95,-1.16),$r],[D(.12,.34,.1,.5,.95,-1.16),$r],[D(.42,.07,.1,0,.76,.5),$r],[D(.34,.3,.32,0,1.16,-.28),ei]],i=ai(this.ghost,this.ghostOpacity);for(let[e,a]of[[n,i.glossy],[r,i.matte]]){let n=ui(e);this.ownedGeometries.push(n);let r=new t(n,a);r.castShadow=!this.ghost,r.receiveShadow=!this.ghost,this.chassis.add(r)}}buildWheels(){let e=ai(this.ghost,this.ghostOpacity).wheel;for(let[n,r,i,a,o]of[[-.82,.95,.32,.26,!0],[.82,.95,.32,.26,!0],[-.9,-.92,.4,.36,!1],[.9,-.92,.4,.36,!1]]){let s=new m(i,i,a,Qr);s.rotateZ(Math.PI/2);let l=ui([[s,ti],[D(a+.02,i*.5,i*.5,0,0,0),ni]]);this.ownedGeometries.push(l);let u=new t(l,e);u.castShadow=!this.ghost;let d=new c;d.position.set(n,i,r),d.add(u),this.root.add(d),this.allWheels.push(u),(o?this.frontPivots:this.rearPivots).push(d)}}update(e,t,n){this.root.position.set(e.x,e.y,e.z),Jr.set(e.groundNormalX,e.groundNormalY,e.groundNormalZ),Yr.setFromUnitVectors(qr,Jr),Xr.setFromAxisAngle(qr,e.heading+e.driftYawOffset),this.root.quaternion.copy(Yr).multiply(Xr);let r=Gr(Math.abs(e.speed)/Math.max(t.maxSpeed,.001),0,1);if(n>0){let t=(e.speed-this.lastSpeed)/n;this.smoothedAccel=Wr(this.smoothedAccel,t,1-Math.exp(-8*n))}this.lastSpeed=e.speed;let i=1-Math.exp(-this.config.leanSmoothing*n),a=e.driftPhase===`drifting`,o=this.config.maxRoll*e.steer*(.35+.65*r);a&&e.driftDir!==0&&(o=o*this.config.driftRollMul+this.config.driftRollBias*e.driftDir*(.4+.6*r));let s=Gr(this.smoothedAccel/Math.max(t.engineAccel,.001),-1.5,1.5),c=-this.config.maxPitch*s;this.roll=Wr(this.roll,o,i),this.pitch=Wr(this.pitch,c,i),this.chassis.rotation.z=this.roll,this.chassis.rotation.x=this.pitch;let l=-e.steer*this.config.steerVisualAngle;for(let e of this.frontPivots)e.rotation.y=l;this.wheelSpin+=e.speed/Math.max(this.config.wheelRadius,.05)*n;for(let e of this.allWheels)e.rotation.x=this.wheelSpin}getWheelWorldPositions(e,t=`rear`){let n=t===`rear`?this.rearPivots:t===`front`?this.frontPivots:[...this.rearPivots,...this.frontPivots];this.root.updateMatrixWorld(!0);for(let t=0;t<n.length;t++){let r=e[t]??(e[t]=new o);n[t].getWorldPosition(r)}return e.length=n.length,e}getRearWheelWorldPositions(e){return this.getWheelWorldPositions(e,`rear`)}getTailWorldPosition(e){return this.root.updateMatrixWorld(!0),e.set(0,.5,-1.3).applyMatrix4(this.root.matrixWorld)}dispose(){this.teardown()}},Qr=20,$r=`#22262e`,ei=`#f0b48b`,ti=`#1b1d22`,ni=`#e8e8ee`,ri=null,ii=null;function ai(e,t){return e?(ii??={glossy:oi(t),matte:oi(t),wheel:oi(t)},ii):(ri??={glossy:new S({vertexColors:!0,roughness:.45,metalness:.15}),matte:new S({vertexColors:!0,roughness:.78,metalness:0}),wheel:new S({vertexColors:!0,roughness:.8,metalness:.1})},ri)}function oi(e){return new S({vertexColors:!0,roughness:.6,metalness:0,transparent:!0,opacity:e,depthWrite:!1,emissive:new x(`#3a5a7a`),emissiveIntensity:.35})}var si=new Map;function ci(e,t){e.traverse(e=>{let n=e;if(!n.isMesh)return;let r=(Array.isArray(n.material)?n.material:[n.material]).map(e=>{let n=e.uuid,r=si.get(n);return r||(r=e.clone(),r.transparent=!0,r.opacity=t,r.depthWrite=!1,si.set(n,r)),r});n.material=Array.isArray(n.material)?r:r[0]})}function D(e,t,n,r,i,a){let o=new g(e,t,n);return o.translate(r,i,a),o}var li=new x;function ui(e){for(let[t,n]of e){li.set(n);let e=t.getAttribute(`position`).count,r=new Float32Array(e*3);for(let t=0;t<e;t++)r[t*3]=li.r,r[t*3+1]=li.g,r[t*3+2]=li.b;t.setAttribute(`color`,new b(r,3))}let t=_e(e.map(([e])=>e));for(let[t]of e)t.dispose();if(!t)throw Error(`KartView: 几何体合并失败（属性对不上？）`);return t}var di=`modulepreload`,fi=function(e,t){return new URL(e,t).href},pi={},mi=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=o(t.map(t=>{if(t=fi(t,n),t=s(t),t in pi)return;pi[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:di,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},hi=Object.freeze({top:`#2f86dd`,horizon:`#a9daff`,bottom:`#7ea7bd`,sun:`#ffeec4`}),gi=new o(.66,.55,-.5).normalize(),_i=300,vi=class{mesh;colors;material;pmrem=null;target=null;hdri=null;constructor(e=hi){this.colors=e,this.material=new C({side:1,depthWrite:!1,fog:!1,uniforms:{uTop:{value:new x(e.top)},uHorizon:{value:new x(e.horizon)},uBottom:{value:new x(e.bottom)},uSun:{value:new x(e.sun)},uSunDir:{value:gi.clone()}},vertexShader:yi,fragmentShader:bi}),this.mesh=new t(new p(_i,24,16),this.material),this.mesh.frustumCulled=!1,this.mesh.renderOrder=-1,this.mesh.name=`sky`}get fogColor(){return this.material.uniforms.uHorizon.value.clone()}follow(e){this.mesh.position.copy(e.position)}apply(e,n,r){if(this.releaseTarget(),r<=0){n.environment=null;return}if(this.pmrem??=new le(e),this.pmrem.compileEquirectangularShader(),this.hdri)this.target=this.pmrem.fromEquirectangular(this.hdri);else{let e=new h,n=new t(this.mesh.geometry,this.material);e.add(n),this.target=this.pmrem.fromScene(e,0,1,_i*2,{size:r}),e.remove(n)}n.environment=this.target.texture,n.environmentIntensity=.6}async loadHdri(e,t){try{let{HDRLoader:n}=await mi(async()=>{let{HDRLoader:e}=await import(`./HDRLoader-Cu5c3GZ9.js`);return{HDRLoader:e}},__vite__mapDeps([0,1]),import.meta.url),r=await new n().loadAsync(e);return r.mapping=303,this.hdri?.dispose(),this.hdri=r,this.mesh.visible=!1,t.background=r,t.backgroundBlurriness=.25,!0}catch(t){return console.warn(`[sky] HDRI 加载失败，继续用渐变天空：${e}`,t),!1}}releaseTarget(){this.target?.dispose(),this.target=null}dispose(){this.releaseTarget(),this.pmrem?.dispose(),this.pmrem=null,this.hdri?.dispose(),this.hdri=null,this.mesh.geometry.dispose(),this.material.dispose()}},yi=`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,bi=`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    // 地平线附近收得紧一点（pow），远处才有"天边亮一条"的感觉
    float up = clamp(dir.y, 0.0, 1.0);
    float down = clamp(-dir.y, 0.0, 1.0);
    vec3 color = mix(uHorizon, uTop, pow(up, 0.55));
    color = mix(color, uBottom, pow(down, 0.4));

    // 太阳：一个很宽的软光晕。不画实心圆盘 —— 卡通风格里一个亮斑就够了，
    // 画了圆盘反而会在 bloom 之后糊成一大团
    float sun = pow(max(dot(dir, normalize(uSunDir)), 0.0), 24.0);
    color += uSun * sun * 0.8;

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`,xi={cones:260,blocks:235,pillarRatio:.23,radius:[20,480],palette:[`#ff5d5d`,`#ffd23f`,`#3ddc97`,`#4d9bff`,`#ff8ac4`,`#ffffff`],groundColor:`#4f7a45`,groundLineColor:`rgba(255,255,255,0.10)`},Si=class e{options;scene=new h;sun;sky;hemi;static GROUND_SIZE=2e3;static GRID_TILE=8;static SUN_DISTANCE=120;decor;fog;groundTexture;cones;boxes;quality;constructor(t={}){this.options=t,this.quality=t.quality??Je.high,this.decor=t.decor??xi,this.sky=new vi(t.sky??hi);let r=this.sky.fogColor;this.scene.background=r,this.scene.add(this.sky.mesh),this.fog=new i(r,this.quality.fogNear,this.quality.fogFar),this.scene.fog=this.fog,this.hemi=new n(`#d6ecff`,`#6b8a52`,Ti),this.hemi.position.set(0,50,0),this.scene.add(this.hemi),this.sun=new d(`#ffe9c4`,2.4),this.sun.position.copy(gi).multiplyScalar(e.SUN_DISTANCE);let a=this.sun.shadow.camera;a.near=1,a.far=e.SUN_DISTANCE*2.6,this.sun.shadow.bias=-6e-4,this.sun.shadow.normalBias=.02,this.scene.add(this.sun),this.scene.add(this.sun.target);let o=this.buildGround();this.groundTexture=o.material.map,this.scene.add(o);let s=this.buildProps();this.cones=s.cones,this.boxes=s.boxes,this.scene.add(s.group),this.setQuality(this.quality)}setQuality(e){this.quality=e,this.fog.near=e.fogNear,this.fog.far=e.fogFar;let t=e.shadowMapSize>0;if(this.sun.castShadow=t,t){let t=this.sun.shadow.camera;t.left=-e.shadowRadius,t.right=e.shadowRadius,t.top=e.shadowRadius,t.bottom=-e.shadowRadius,t.updateProjectionMatrix(),this.sun.shadow.mapSize.x!==e.shadowMapSize&&(this.sun.shadow.mapSize.setScalar(e.shadowMapSize),this.sun.shadow.map?.dispose(),this.sun.shadow.map=null)}let n=e.envMapSize>0&&this.options.renderer!==void 0;this.options.renderer&&this.sky.apply(this.options.renderer,this.scene,e.envMapSize),this.hemi.intensity=n?wi:Ti,this.groundTexture.anisotropy=e.textureAnisotropy,this.groundTexture.needsUpdate=!0;let r=Math.max(0,Math.min(1,e.propDensity));this.cones.count=Math.round(this.decor.cones*r),this.boxes.count=Math.round(this.decor.blocks*r)}followShadow(t,n,r){this.sun.castShadow&&(this.sun.target.position.set(t,n,r),this.sun.target.updateMatrixWorld(),this.sun.position.copy(gi).multiplyScalar(e.SUN_DISTANCE).add(this.sun.target.position))}update(e){this.sky.follow(e)}buildGround(){let n=new _(Ei(this.decor.groundColor,this.decor.groundLineColor));n.wrapS=n.wrapT=fe,n.repeat.set(e.GROUND_SIZE/e.GRID_TILE,e.GROUND_SIZE/e.GRID_TILE),n.colorSpace=w;let r=new t(new v(e.GROUND_SIZE,e.GROUND_SIZE),new S({map:n,roughness:.95,metalness:0}));return r.rotation.x=-Math.PI/2,r.position.y=this.groundY,r.receiveShadow=!0,r}get groundY(){return this.options.groundY??0}buildProps(){let e=new c,t=Di(12648430),n=this.decor.palette.map(e=>new x(e)),r=new S({roughness:.6,metalness:.05}),i=new s(new te(.9,2.4,12),r,Math.max(1,this.decor.cones)),l=new s(new g(1,1,1),r,Math.max(1,this.decor.blocks));for(let t of[i,l])t.castShadow=!0,t.receiveShadow=!0,t.instanceMatrix.setUsage(a),e.add(t);let d=this.options.isBlocked??(()=>!1),f=this.groundY,p=new u,m=new o,h=new ne,_=new o(1,1,1),[v,y]=this.decor.radius,ee=(e,r,i)=>{for(let a=0;a<12;a++){let a=t()*Math.PI*2,o=v+Math.sqrt(t())*(y-v),s=Math.cos(a)*o,c=Math.sin(a)*o;if(!d(s,c))return m.set(s,f+i,c),h.setFromAxisAngle(Ci,t()*Math.PI*2),e.setMatrixAt(r,p.compose(m,h,_)),e.setColorAt(r,n[Math.floor(t()*n.length)]),!0}return e.setMatrixAt(r,p.makeScale(0,0,0)),e.setColorAt(r,n[0]),!1};for(let e=0;e<this.decor.cones;e++)_.set(1,1,1),ee(i,e,1.2);let re=Math.round(this.decor.blocks*(1-this.decor.pillarRatio));for(let e=0;e<this.decor.blocks;e++){let n=e>=re,r=n?10+t()*22:1+t()*5;n?_.set(2.5,r,2.5):_.set(1+t()*2.5,r,1+t()*2.5),ee(l,e,r/2)}return i.instanceMatrix.needsUpdate=!0,l.instanceMatrix.needsUpdate=!0,i.instanceColor&&(i.instanceColor.needsUpdate=!0),l.instanceColor&&(l.instanceColor.needsUpdate=!0),i.computeBoundingSphere(),l.computeBoundingSphere(),{group:e,cones:i,boxes:l}}},Ci=new o(0,1,0),wi=.35,Ti=1.15;function Ei(e,t){let n=document.createElement(`canvas`);n.width=n.height=256;let r=n.getContext(`2d`);r.fillStyle=e,r.fillRect(0,0,256,256),r.strokeStyle=t,r.lineWidth=2;for(let e=1;e<4;e++){let t=64*e;r.beginPath(),r.moveTo(t,0),r.lineTo(t,256),r.moveTo(0,t),r.lineTo(256,t),r.stroke()}return r.strokeStyle=t.replace(/[\d.]+\)$/,`0.45)`),r.lineWidth=6,r.strokeRect(0,0,256,256),n}function Di(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=Math.imul(t^t>>>15,1|t);return e=e+Math.imul(e^e>>>7,61|e)^e,((e^e>>>14)>>>0)/4294967296}}var Oi=class{radius;mesh;matrix=new u;position=new o;quaternion=new ne;scale=new o;constructor(e,t=1.15){this.radius=t;let n=new v(2,2);n.rotateX(-Math.PI/2);let r=new y({map:new _(ki()),transparent:!0,opacity:.5,depthWrite:!1,color:0,blending:1});r.map.colorSpace=w,this.mesh=new s(n,r,e),this.mesh.frustumCulled=!1,this.mesh.renderOrder=1,this.mesh.count=0}begin(){this.mesh.count=0}add(e,t,n,r=0){let i=this.mesh.count;if(i>=this.mesh.instanceMatrix.count)return;let a=Math.max(0,1-r/3),o=this.radius*(1+r*.12);this.position.set(e,t+.03,n),this.scale.set(o*a,1,o*a),this.mesh.setMatrixAt(i,this.matrix.compose(this.position,this.quaternion,this.scale)),this.mesh.count=i+1}finish(){this.mesh.instanceMatrix.needsUpdate=!0}setVisible(e){this.mesh.visible=e}dispose(){this.mesh.geometry.dispose();let e=this.mesh.material;e.map?.dispose(),e.dispose()}};function ki(){let e=document.createElement(`canvas`);e.width=e.height=64;let t=e.getContext(`2d`),n=t.createRadialGradient(32,32,0,32,32,32);return n.addColorStop(0,`rgba(255,255,255,1)`),n.addColorStop(.55,`rgba(255,255,255,0.72)`),n.addColorStop(1,`rgba(255,255,255,0)`),t.fillStyle=n,t.fillRect(0,0,64,64),e}var Ai=class{renderer;scene;camera;composer=null;bloom=null;width=1;height=1;constructor(e,t,n,r){this.renderer=e,this.scene=t,this.camera=n;let i=e.getSize(new l);this.width=i.x,this.height=i.y,this.setQuality(r)}get active(){return this.composer!==null}setQuality(e){if(this.disposeComposer(),e.postFx===`none`){this.renderer.toneMapping=4;return}this.renderer.toneMapping=0;let t=new Se(this.renderer,{frameBufferType:ie,multisampling:0});t.addPass(new be(this.scene,this.camera));let n=[];e.bloomStrength>0&&(this.bloom=new Ee({intensity:e.bloomStrength,luminanceThreshold:.85,luminanceSmoothing:.1,radius:e.bloomRadius,mipmapBlur:!0}),n.push(this.bloom)),e.smaa&&n.push(new ve({preset:Ce.MEDIUM})),e.vignette>0&&n.push(new xe({offset:.35,darkness:e.vignette})),n.push(new Te({mode:ye.ACES_FILMIC})),t.addPass(new we(this.camera,...n)),t.setSize(this.width,this.height),this.composer=t}setCamera(e){this.camera=e}setSize(e,t){this.width=e,this.height=t,this.composer?.setSize(e,t)}render(e=0){this.composer?this.composer.render(e):this.renderer.render(this.scene,this.camera)}disposeComposer(){this.composer?.dispose(),this.composer=null,this.bloom=null}dispose(){this.disposeComposer()}},ji=Object.freeze({sampleCount:60,targetFps:30,tolerance:1.05,warmupSeconds:3,sustainSeconds:2.5,cooldownSeconds:8,spikeCutoffSeconds:.5}),Mi=class{cfg;samples;cursor=0;filled=0;sum=0;warmup;cooldown=0;badTime=0;constructor(e={}){this.cfg={...ji,...e},this.samples=new Float64Array(this.cfg.sampleCount),this.warmup=this.cfg.warmupSeconds}get averageFps(){return this.filled<this.cfg.sampleCount||this.sum<=0?0:this.filled/this.sum}get pendingSeconds(){return this.badTime}push(e){if(!(e>0)||e>this.cfg.spikeCutoffSeconds)return!1;if(this.sum+=e-this.samples[this.cursor],this.samples[this.cursor]=e,this.cursor=(this.cursor+1)%this.cfg.sampleCount,this.filled<this.cfg.sampleCount&&this.filled++,this.warmup>0)return this.warmup-=e,!1;if(this.cooldown>0)return this.cooldown-=e,!1;if(this.filled<this.cfg.sampleCount)return!1;let t=1/this.cfg.targetFps*this.cfg.tolerance;return this.sum/this.filled<=t?(this.badTime=0,!1):(this.badTime+=e,this.badTime<this.cfg.sustainSeconds?!1:(this.badTime=0,this.cooldown=this.cfg.cooldownSeconds,!0))}reset(e=this.cfg.warmupSeconds){this.samples.fill(0),this.cursor=0,this.filled=0,this.sum=0,this.badTime=0,this.cooldown=0,this.warmup=e}};function Ni(e,t){if(t!==`low`)return[];let{calls:n,triangles:r}=e.info.render,i=[];return n>Ye.drawCalls&&i.push(`drawcall ${n} 超了预算 ${Ye.drawCalls}（用 InstancedMesh 合并重复物件）`),r>Ye.triangles&&i.push(`三角面 ${r} 超了预算 ${Ye.triangles}`),i}var Pi=10485760,Fi=`.ktx2`,Ii=[`.png`,`.jpg`,`.jpeg`,`.webp`,`.gif`,`.bmp`,`.tga`],Li=[`.glb`,`.gltf`],Ri=[];function zi(e,t){return e.filter(e=>e.phase===t)}function Bi(e){return e.reduce((e,t)=>e+t.bytes,0)}function Vi(e,t){return e.variants?.[t]??e.url}var Hi=(e,t)=>{let n=e.toLowerCase();return t.some(e=>n.endsWith(e))};function Ui(e){let t=[],n=new Set;for(let r of e){let e=`资源 "${r.id}"`;n.has(r.id)&&t.push(`${e}: id 重复`),n.add(r.id),r.bytes>=0||t.push(`${e}: bytes 必须是非负数`);let i=[r.url,...Object.values(r.variants??{})];for(let n of i)r.kind===`texture`?Hi(n,Ii)?t.push(`${e}: 贴图不许用 ${n.slice(n.lastIndexOf(`.`))}，转成 KTX2（npm run assets:convert）`):Hi(n,[Fi])||t.push(`${e}: 贴图必须是 ${Fi}，拿到的是 ${n}`):Hi(n,Li)||t.push(`${e}: 模型必须是 ${Li.join(` / `)}，拿到的是 ${n}`);r.kind===`model`&&!r.compression&&t.push(`${e}: 模型必须声明 compression（draco 或 meshopt），未压缩的几何不许进包`)}let r=Bi(zi(e,`core`));return r>10485760&&t.push(`首屏资源 ${(r/1024/1024).toFixed(2)}MB 超了 ${Pi/1024/1024}MB 预算，把不是开局必须的挪到 phase='deferred'`),t}var Wi=`[assets] 解码器没接线：清单里有资源，但 KTX2/draco/meshopt 的 import 还断着。按 src/assets/decoders.ts 顶上的说明改 AssetLoader 的两个 getter。`,Gi=class{renderer;manifest;tier;basePath;textures=new Map;models=new Map;loaded=new Set;ktx2=null;gltf=null;constructor(e,t){this.renderer=e,this.manifest=t.manifest??Ri,this.tier=t.tier,this.basePath=t.basePath??`./`;let n=Ui(this.manifest);n.length>0&&console.error(`[assets] 资源清单有问题：
`+n.map(e=>`  - `+e).join(`
`))}get webglRenderer(){return this.renderer}phaseBytes(e){return Bi(zi(this.manifest,e))}async loadPhase(e,t){if(this.loaded.has(e))return;this.loaded.add(e);let n=zi(this.manifest,e),r=Bi(n)||1;if(n.length===0){t?.(1);return}let i=0,a=new Map,o=()=>{let e=i;for(let t of a.values())e+=t;t?.(Math.min(e/r,1))};await Promise.all(n.map(async e=>{let t=this.basePath+Vi(e,this.tier),n=t=>{t.total>0&&a.set(e.id,t.loaded/t.total*e.bytes),o()};try{if(e.kind===`texture`){let r=await(await this.ktx2Loader()).loadAsync(t,n);r.colorSpace=w,this.textures.set(e.id,r)}else this.models.set(e.id,await(await this.gltfLoader()).loadAsync(t,n))}catch(n){console.error(`[assets] 加载失败：${e.id} (${t})`,n)}finally{a.delete(e.id),i+=e.bytes,o()}})),t?.(1)}texture(e){return this.textures.get(e)??null}model(e){return this.models.get(e)??null}ktx2Loader(){return this.ktx2??Promise.reject(Error(Wi))}gltfLoader(){return this.gltf??Promise.reject(Error(Wi))}dispose(){for(let e of this.textures.values())e.dispose();this.textures.clear(),this.models.clear(),this.ktx2?.then(e=>e.dispose()).catch(()=>{}),this.ktx2=null,this.gltf=null}},Ki=class{onChange;tasks;ratios=new Map;totalWeight;constructor(e,t){this.onChange=t,this.tasks=e,this.totalWeight=e.reduce((e,t)=>e+Math.max(t.weight,0),0)||1;for(let t of e)this.ratios.set(t.id,0);this.emit()}set(e,t){if(!this.ratios.has(e))return;let n=t<0?0:t>1?1:t;n<=this.ratios.get(e)||(this.ratios.set(e,n),this.emit())}complete(e){this.set(e,1)}snapshot(){let e=0,t=this.tasks[this.tasks.length-1]?.label??``,n=!1;for(let r of this.tasks){let i=this.ratios.get(r.id)??0;e+=i*Math.max(r.weight,0),!n&&i<1&&(t=r.label,n=!0)}let r=e/this.totalWeight;return{ratio:r,label:t,done:r>=1}}emit(){this.onChange?.(this.snapshot())}},qi=class{options;basePath;loader=null;pending=new Map;cache=new Map;constructor(e={}){this.options=e,this.basePath=e.basePath??`./`}async load(e,t){let n=this.cache.get(e);if(n)return n;let r=this.pending.get(e);return r||(r=this.fetch(e,t),this.pending.set(e,r)),r}async fetch(e,t){try{let n=await(await this.getLoader()).loadAsync(this.basePath+Ji(e),t);return this.cache.set(e,n),n}catch(t){return console.warn(`[models] 加载失败，退回程序化占位：${e}`,t),null}finally{this.pending.delete(e)}}get(e){return this.cache.get(e)??null}instantiate(e){let t=this.cache.get(e);return t?t.scene.clone(!0):null}getLoader(){return this.loader??=(async()=>{let{GLTFLoader:e}=await mi(async()=>{let{GLTFLoader:e}=await import(`./GLTFLoader-DjaFp1g3.js`);return{GLTFLoader:e}},__vite__mapDeps([2,1,3]),import.meta.url),t=new e;return await this.options.decorate?.(t),t})(),this.loader}dispose(){for(let e of this.cache.values())Yi(e.scene);this.cache.clear(),this.pending.clear()}},Ji=e=>e.startsWith(`/`)?e.slice(1):e;function Yi(e){let t=new Set,n=new Set;e.traverse(e=>{let r=e;if(r.isMesh){t.add(r.geometry);for(let e of Xi(r.material))n.add(e)}});for(let e of t)e.dispose();for(let e of n)e.dispose()}function Xi(e){return Array.isArray(e)?e:[e]}var Zi=`models/kart.glb`,Qi=`hdri/afternoon.hdr`,O=e(),$i=[1,1.5,2.25],ea=Object.freeze({engine:{id:`engine`,file:`audio/engine-loop.webm`,bus:`sfx`,volume:.34,loop:!0,synth:{wave:`saw`,freq:80,duration:.5,harmonics:6,noise:.06,seamless:!0,gain:.5}},driftLoop:{id:`driftLoop`,file:`audio/drift-loop.webm`,bus:`sfx`,volume:.3,loop:!0,synth:{wave:`triangle`,freq:620,duration:.4,noise:.85,seamless:!0,gain:.42}},charge:{id:`charge`,file:`audio/charge-loop.webm`,bus:`sfx`,volume:.24,loop:!0,synth:{wave:`sine`,freq:300,freqEnd:460,duration:.5,harmonics:3,gain:.5}},boost:{id:`boost`,file:`audio/boost.webm`,bus:`sfx`,volume:.55,loop:!1,maxVoices:3,synth:{wave:`saw`,freq:180,freqEnd:900,duration:.42,harmonics:4,noise:.2,attack:.005,release:.25}},itemGet:{id:`itemGet`,file:`audio/item-get.webm`,bus:`sfx`,volume:.5,loop:!1,maxVoices:2,synth:{wave:`square`,freq:520,freqEnd:1040,duration:.26,attack:.004,release:.14}},itemUse:{id:`itemUse`,file:`audio/item-use.webm`,bus:`sfx`,volume:.45,loop:!1,maxVoices:3,synth:{wave:`square`,freq:880,freqEnd:440,duration:.18,attack:.003,release:.1}},itemHit:{id:`itemHit`,file:`audio/item-hit.webm`,bus:`sfx`,volume:.62,loop:!1,maxVoices:4,synth:{wave:`saw`,freq:420,freqEnd:70,duration:.4,harmonics:3,noise:.45,attack:.002,release:.3}},shieldBlock:{id:`shieldBlock`,file:`audio/shield-block.webm`,bus:`sfx`,volume:.5,loop:!1,maxVoices:2,synth:{wave:`sine`,freq:1200,freqEnd:700,duration:.3,harmonics:4,attack:.002,release:.24}},wallHit:{id:`wallHit`,file:`audio/wall-hit.webm`,bus:`sfx`,volume:.45,loop:!1,maxVoices:2,synth:{wave:`noise`,freq:200,duration:.16,attack:.001,release:.14,gain:.7}},kartHit:{id:`kartHit`,file:`audio/kart-hit.webm`,bus:`sfx`,volume:.36,loop:!1,maxVoices:3,synth:{wave:`triangle`,freq:160,freqEnd:90,duration:.14,noise:.35,attack:.001,release:.12}},countdown:{id:`countdown`,file:`audio/countdown.webm`,bus:`sfx`,volume:.6,loop:!1,synth:{wave:`sine`,freq:440,duration:.22,harmonics:2,attack:.004,release:.16}},countdownGo:{id:`countdownGo`,file:`audio/countdown-go.webm`,bus:`sfx`,volume:.7,loop:!1,synth:{wave:`sine`,freq:880,duration:.5,harmonics:3,attack:.004,release:.4}},lap:{id:`lap`,file:`audio/lap.webm`,bus:`sfx`,volume:.5,loop:!1,synth:{wave:`sine`,freq:660,freqEnd:990,duration:.32,harmonics:2,attack:.005,release:.22}},record:{id:`record`,file:`audio/record.webm`,bus:`sfx`,volume:.6,loop:!1,synth:{wave:`sine`,freq:784,freqEnd:1568,duration:.7,harmonics:4,attack:.006,release:.5}},finish:{id:`finish`,file:`audio/finish.webm`,bus:`sfx`,volume:.65,loop:!1,synth:{wave:`square`,freq:523,freqEnd:1046,duration:.9,harmonics:3,attack:.008,release:.6}},uiClick:{id:`uiClick`,file:`audio/ui-click.webm`,bus:`sfx`,volume:.35,loop:!1,maxVoices:2,synth:{wave:`square`,freq:900,duration:.06,attack:.001,release:.05}},music:{id:`music`,file:`audio/music.webm`,bus:`music`,volume:.5,loop:!0,synth:{wave:`triangle`,freq:110,duration:1,harmonics:3,seamless:!0,gain:.28}}}),ta=Object.keys(ea),na=11025;function ra(e,t=na){let n=oa(e),r=Math.max(1,Math.round(n*t)),i=new Float32Array(r),a=Zn(e.seed??24301),o=Math.max(1,Math.floor(e.harmonics??1)),s=ua(e.noise??0),c=e.gain??.8,l=Math.max(0,e.attack??.005),u=Math.max(0,e.release??n*.35),d=0;for(let f=0;f<r;f++){let p=f/t,m=r>1?f/(r-1):0,h=e.freqEnd===void 0?e.freq:da(e.freq,e.freqEnd,m),g=0;if(e.wave===`noise`)g=a.next()*2-1;else{let t=0,n=0;for(let r=1;r<=o;r++){let i=1/r;t+=ia(e.wave,d*r)*i,n+=i}g=t/n}s>0&&(g=g*(1-s)+(a.next()*2-1)*s),i[f]=g*c*aa(p,n,l,u,e.seamless===!0),d+=h/t}return i}function ia(e,t){let n=t-Math.floor(t);switch(e){case`sine`:return Math.sin(n*Math.PI*2);case`square`:return n<.5?1:-1;case`saw`:return n*2-1;case`triangle`:return n<.5?n*4-1:3-n*4;default:return 0}}function aa(e,t,n,r,i){if(i)return 1;let a=n>0?Math.min(e/n,1):1,o=Math.max(0,t-r),s=r>0&&e>o?1-(e-o)/r:1;return Math.max(0,a*s)}function oa(e){return!e.seamless||e.freqEnd!==void 0||e.freq<=0?e.duration:Math.max(1,Math.round(e.duration*e.freq))/e.freq}function sa(e,t=na){let n=new Uint8Array(44+e.length*2),r=new DataView(n.buffer),i=(e,t)=>{for(let n=0;n<t.length;n++)r.setUint8(e+n,t.charCodeAt(n))};i(0,`RIFF`),r.setUint32(4,36+e.length*2,!0),i(8,`WAVE`),i(12,`fmt `),r.setUint32(16,16,!0),r.setUint16(20,1,!0),r.setUint16(22,1,!0),r.setUint32(24,t,!0),r.setUint32(28,t*2,!0),r.setUint16(32,2,!0),r.setUint16(34,16,!0),i(36,`data`),r.setUint32(40,e.length*2,!0);for(let t=0;t<e.length;t++){let n=Math.max(-1,Math.min(1,e[t]));r.setInt16(44+t*2,n<0?n*32768:n*32767,!0)}return n}function ca(e,t=na){return`data:audio/wav;base64,${la(sa(ra(e,t),t))}`}function la(e){let t=``,n=32768;for(let r=0;r<e.length;r+=n)t+=String.fromCharCode(...e.subarray(r,r+n));return btoa(t)}var ua=e=>e<0?0:e>1?1:e,da=(e,t,n)=>e+(t-e)*n,fa=Object.freeze({master:.8,sfx:1,music:.55,muted:!1}),pa=class{options;settings;basePath;entries=new Map;loops=new Map;ready=!1;disposed=!1;constructor(e={}){this.options=e,this.settings={...fa,...e.settings},this.basePath=e.basePath??`./`,O.Howler.volume(this.settings.muted?0:this.settings.master)}init(){if(!(this.ready||this.disposed)){this.ready=!0;for(let e of ta)this.create(ea[e]);this.resume();for(let e of ma)window.addEventListener(e,this.onGesture,ha);document.addEventListener(`visibilitychange`,this.onVisibility)}}get running(){return O.Howler.ctx?.state===`running`}resume(){let e=O.Howler.ctx;if(e){e.resume();try{let t=e.createBufferSource();t.buffer=e.createBuffer(1,1,e.sampleRate),t.connect(e.destination),t.start(0)}catch{}}}onGesture=()=>{this.disposed||this.running||this.resume()};onVisibility=()=>{document.visibilityState===`visible`&&this.resume()};get context(){return O.Howler.ctx??null}get syntheticCount(){let e=0;for(let t of this.entries.values())t.synthetic&&e++;return e}create(e){let t=new O.Howl({src:[this.basePath+e.file],loop:e.loop,volume:this.gainFor(e),html5:!1,preload:!0,onloaderror:()=>this.fallbackToSynth(e)});this.entries.set(e.id,{def:e,howl:t,synthetic:!1,voices:[]})}fallbackToSynth(e){let t=this.entries.get(e.id);if(!t||t.synthetic||this.disposed)return;t.howl.unload();let n=new O.Howl({src:[ca(e.synth)],format:[`wav`],loop:e.loop,volume:this.gainFor(e),html5:!1,preload:!0});this.entries.set(e.id,{def:e,howl:n,synthetic:!0,voices:[]});let r=this.loops.get(e.id);if(r){let t=n.play();n.volume(this.gainFor(e)*r.volume,t),this.loops.set(e.id,{id:t,volume:r.volume})}}play(e,t=1,n=1){let r=this.entries.get(e);if(!r||this.settings.muted)return;let i=r.def.maxVoices??8;r.voices=r.voices.filter(e=>r.howl.playing(e)),r.voices.length>=i&&r.howl.stop(r.voices.shift());let a=r.howl.play();r.howl.rate(t,a),r.howl.volume(this.gainFor(r.def)*n,a),r.voices.push(a)}loop(e,t=1){let n=this.entries.get(e),r=this.loops.get(e);if(n&&!r){let r=n.howl.play();n.howl.volume(this.gainFor(n.def)*t,r),this.loops.set(e,{id:r,volume:t})}else r&&(r.volume=t);return{setVolume:t=>{let n=this.entries.get(e),r=this.loops.get(e);n&&r&&(r.volume=t,n.howl.volume(this.gainFor(n.def)*t,r.id))},setRate:t=>{let n=this.entries.get(e),r=this.loops.get(e);n&&r&&n.howl.rate(Math.max(.5,Math.min(t,4)),r.id)},stop:()=>{let t=this.entries.get(e),n=this.loops.get(e);t&&n&&(t.howl.stop(n.id),this.loops.delete(e))}}}stopLoops(){for(let[e,t]of this.loops)this.entries.get(e)?.howl.stop(t.id);this.loops.clear()}get current(){return this.settings}setMuted(e){this.settings.muted=e,O.Howler.volume(e?0:this.settings.master),this.options.onSettingsChange?.(this.settings)}setVolume(e,t){let n=Math.max(0,Math.min(t,1));e===`master`?(this.settings.master=n,this.settings.muted||O.Howler.volume(n)):(this.settings[e]=n,this.refreshBus(e)),this.options.onSettingsChange?.(this.settings)}refreshBus(e){for(let[t,n]of this.loops){let r=this.entries.get(t);r&&r.def.bus===e&&r.howl.volume(this.gainFor(r.def)*n.volume,n.id)}}gainFor(e){return e.volume*this.settings[e.bus]}dispose(){this.disposed=!0;for(let e of ma)window.removeEventListener(e,this.onGesture,ha);document.removeEventListener(`visibilitychange`,this.onVisibility),this.stopLoops();for(let e of this.entries.values())e.howl.unload();this.entries.clear()}},ma=[`touchend`,`pointerdown`,`mousedown`,`keydown`],ha={passive:!0},ga=.75,_a=.35,va=.35,ya=class{audio;engine=null;drift=null;charge=null;onWall=!1;prevContacts=0;hitCooldown=0;started=!1;constructor(e){this.audio=e}start(){this.started||(this.started=!0,this.engine=this.audio.loop(`engine`,0),this.drift=this.audio.loop(`driftLoop`,0),this.charge=this.audio.loop(`charge`,0),this.audio.loop(`music`,1))}update(e){if(!this.started)return;let{state:t,config:n,frameDt:r}=e;this.hitCooldown=Math.max(0,this.hitCooldown-r);let i=ba(Math.abs(t.speed)/Math.max(n.maxSpeed,.001)),a=t.boostTime>0,o=ga+1.6*i+(a?_a:0);this.engine?.setRate(o);let s=t.airborne?.6:1;this.engine?.setVolume((va+.65*i)*s*(e.racing?1:.5));let c=t.driftPhase===`drifting`&&!t.airborne;if(this.drift?.setVolume(c?.35+.65*i:0),c){let e=t.driftLevel;this.charge?.setRate($i[Math.max(0,e-1)]),this.charge?.setVolume(e>0?1:.45)}else this.charge?.setVolume(0);let l=e.halfWidth>0&&Math.abs(t.lateralOffset)>=e.halfWidth-.15;l&&!this.onWall&&i>.15&&this.hitCooldown<=0&&(this.audio.play(`wallHit`,.9+Math.random()*.2,.4+.6*i),this.hitCooldown=.18),this.onWall=l,e.contacts>this.prevContacts&&this.hitCooldown<=0&&(this.audio.play(`kartHit`,.9+Math.random()*.25,.5+.5*i),this.hitCooldown=.12),this.prevContacts=e.contacts}onKartEvent(e){if(this.started)switch(e.type){case`boostStart`:this.audio.play(`boost`,1.12-e.level*.06);break;case`driftLevelUp`:this.audio.play(`uiClick`,$i[e.level-1])}}onRaceEvent(e,t){if(this.started)switch(e.type){case`countdownTick`:this.audio.play(`countdown`);break;case`go`:this.audio.play(`countdownGo`);break;case`lap`:e.id===t&&this.audio.play(e.best?`record`:`lap`);break;case`racerFinished`:e.id===t&&this.audio.play(`finish`)}}onItemEvent(e,t){if(this.started&&e.kartId===t)switch(e.type){case`pickup`:this.audio.play(`itemGet`);break;case`use`:this.audio.play(`itemUse`);break;case`hit`:this.audio.play(`itemHit`);break;case`blocked`:this.audio.play(`shieldBlock`)}}onNewRecord(){this.started&&this.audio.play(`record`)}reset(){this.onWall=!1,this.prevContacts=0,this.hitCooldown=0}stop(){this.engine?.stop(),this.drift?.stop(),this.charge?.stop(),this.engine=this.drift=this.charge=null,this.started=!1}},ba=e=>e<0?0:e>1?1:e,xa=`kart-new.bestLap.v1`;function Sa(e){return`kart-new.bestLap.v1.${e}`}var Ca=class{storage;key;cached;constructor(e,t=xa){this.storage=e,this.key=t,this.cached=this.read()}get best(){return this.cached}submit(e){return!Number.isFinite(e)||e<=0||this.cached!==null&&e>=this.cached?!1:(this.cached=e,this.write(e),!0)}clear(){this.cached=null;try{this.storage?.removeItem(this.key)}catch{}}read(){try{let e=this.storage?.getItem(this.key);if(e==null)return null;let t=Number.parseFloat(e);return Number.isFinite(t)&&t>0?t:null}catch{return null}}write(e){try{this.storage?.setItem(this.key,String(e))}catch{}}};function wa(){try{return typeof localStorage>`u`?null:localStorage}catch{return null}}var Ta=100,Ea=1e3,Da=class{interval;samples=[];accumulator=0;elapsed=0;constructor(e=1/20){this.interval=e}get length(){return this.samples.length}reset(){this.samples.length=0,this.accumulator=0,this.elapsed=0}push(e,t){if(this.samples.length===0){this.samples.push({...t});return}for(this.elapsed+=e,this.accumulator+=e;this.accumulator>=this.interval;)this.accumulator-=this.interval,this.samples.push({...t})}finish(e){return this.samples.length<10?null:{version:1,lapTime:e,interval:this.interval,data:ka(this.samples)}}},Oa=class{samples;interval;lapTime;out={x:0,y:0,z:0,heading:0};constructor(e){this.samples=Aa(e.data),this.interval=e.interval>0?e.interval:1/20,this.lapTime=e.lapTime}get duration(){return Math.max(0,(this.samples.length-1)*this.interval)}get valid(){return this.samples.length>=2}sampleAt(e){let t=this.samples.length;if(t===0)return this.out;if(e<=0)return this.samples[0];let n=e/this.interval,r=Math.floor(n);if(r>=t-1)return this.samples[t-1];let i=this.samples[r],a=this.samples[r+1],o=n-r;return this.out.x=i.x+(a.x-i.x)*o,this.out.y=i.y+(a.y-i.y)*o,this.out.z=i.z+(a.z-i.z)*o,this.out.heading=i.heading+(a.heading-i.heading)*o,this.out}};function ka(e){let t=[],n=0,r=0,i=0,a=0;for(let o of e){let e=Math.round(o.x*Ta),s=Math.round(o.y*Ta),c=Math.round(o.z*Ta),l=Math.round(o.heading*Ea);Na(t,ja(e-n)),Na(t,ja(s-r)),Na(t,ja(c-i)),Na(t,ja(l-a)),n=e,r=s,i=c,a=l}return Fa(Uint8Array.from(t))}function Aa(e){let t;try{t=Ia(e)}catch{return[]}let n=[],r=0,i=0,a=0,o=0,s=0;for(;s<t.length;){let e=()=>{let[e,n]=Pa(t,s);return s=n,Ma(e)},c=s;if(r+=e(),i+=e(),a+=e(),o+=e(),s===c||s>t.length)break;n.push({x:r/Ta,y:i/Ta,z:a/Ta,heading:o/Ea})}return n}function ja(e){return e<0?-e*2-1:e*2}function Ma(e){return e%2==0?e/2:-(e+1)/2}function Na(e,t){let n=t;for(;n>=128;)e.push(n&127|128),n=Math.floor(n/128);e.push(n&127)}function Pa(e,t){let n=0,r=1,i=t;for(;i<e.length;){let t=e[i];if(i++,n+=(t&127)*r,!(t&128))return[n,i];r*=128}return[n,i]}function Fa(e){let t=``,n=32768;for(let r=0;r<e.length;r+=n)t+=String.fromCharCode(...e.subarray(r,r+n));return btoa(t)}function Ia(e){let t=atob(e),n=new Uint8Array(t.length);for(let e=0;e<t.length;e++)n[e]=t.charCodeAt(e);return n}function La(e){return`kart-new.ghost.v1.${e}`}var Ra=class{storage;trackId;constructor(e,t){this.storage=e,this.trackId=t}load(){try{let e=this.storage?.getItem(La(this.trackId));if(!e)return null;let t=JSON.parse(e);if(t.version!==1||typeof t.data!=`string`||typeof t.lapTime!=`number`||!Number.isFinite(t.lapTime)||t.lapTime<=0)return null;let n=typeof t.interval==`number`&&t.interval>0?t.interval:1/20;return{version:1,lapTime:t.lapTime,interval:n,data:t.data}}catch{return null}}saveIfFaster(e){let t=this.load();if(t&&t.lapTime<=e.lapTime)return!1;try{return this.storage?.setItem(La(this.trackId),JSON.stringify(e)),!0}catch{return!1}}clear(){try{this.storage?.removeItem(La(this.trackId))}catch{}}};function za(){try{return typeof localStorage>`u`?null:localStorage}catch{return null}}var Ba=class{checkpointCount;_lap=0;_t=0;_sector=0;_visited;_lineCredited=!1;_lapTime=0;_totalTime=0;_lapTimes=[];_bestLap=null;constructor(e={}){this.checkpointCount=Math.max(2,Math.floor(e.checkpointCount??8)),this._visited=Array(this.checkpointCount).fill(!1),this.reset(e.startT??0)}reset(e=0){this._t=Va(e),this._sector=this.sectorOf(this._t),this._visited.fill(!1),this._lineCredited=!1,this._lap=0,this._lapTime=0,this._totalTime=0,this._lapTimes=[],this._bestLap=null}update(e,t=0){if(!Number.isFinite(e))return null;t>0&&(this._lapTime+=t,this._totalTime+=t);let n=Va(e);this._t=n;let r=this.sectorOf(n);if(r===this._sector)return null;let i=this.checkpointCount,a=this._sector;return this._sector=r,(r-a+i)%i===1?this.crossForward(r):(a-r+i)%i===1?(this.crossBackward(a),null):(this._visited.fill(!1),null)}crossForward(e){if(e!==0)return this._visited[e]=!0,null;let t=this.allCheckpointsPassed();if(this._visited.fill(!1),this._lineCredited=t,!t)return null;let n=this._lapTime;this._lapTime=0,this._lap+=1,this._lapTimes.push(n);let r=this._bestLap===null||n<this._bestLap;return r&&(this._bestLap=n),{lap:this._lap,time:n,best:r}}crossBackward(e){if(e!==0){this._visited[e]=!1;return}this._lineCredited&&(this._lineCredited=!1,--this._lap,this._lapTime+=this._lapTimes.pop()??0,this._bestLap=Ha(this._lapTimes),this._visited.fill(!0),this._visited[0]=!1)}allCheckpointsPassed(){for(let e=1;e<this.checkpointCount;e++)if(!this._visited[e])return!1;return!0}sectorOf(e){let t=Math.floor(e*this.checkpointCount);return t<0?0:t>=this.checkpointCount?this.checkpointCount-1:t}get lap(){return this._lap}get t(){return this._t}get totalProgress(){return this._lap+this._t}get lapTime(){return this._lapTime}get totalTime(){return this._totalTime}get lapTimes(){return this._lapTimes}get bestLap(){return this._bestLap}get lastLap(){return this._lapTimes.length===0?null:this._lapTimes[this._lapTimes.length-1]}get sector(){return this._sector}get lapValid(){for(let e=1;e<=this._sector;e++)if(!this._visited[e])return!1;return!0}get missingCheckpoints(){let e=[];for(let t=1;t<this.checkpointCount;t++)this._visited[t]||e.push(t);return e}checkpointT(e){let t=this.checkpointCount;return(e%t+t)%t/t}getLastCheckpoint(){return{index:this._sector,t:this.checkpointT(this._sector)}}};function Va(e){let t=e%1;return t<0?t+1:t}function Ha(e){let t=null;for(let n of e)(t===null||n<t)&&(t=n);return t}var Ua=1e-6,Wa={totalLaps:3,countdownDuration:3,checkpointCount:8},Ga=class{config;racers;byId=new Map;_phase=`countdown`;_countdown;_shownCount=-1;_time=0;_finishedCount=0;events=[];_standings=[];constructor(e,t={}){this.config={...Wa,...t},this._countdown=this.config.countdownDuration,this.racers=e.map(e=>({id:e.id,name:e.name??e.id,isPlayer:e.isPlayer??!1,startT:e.startT??0,progress:new Ba({checkpointCount:this.config.checkpointCount,startT:e.startT??0}),finished:!1,finishTime:null,place:0}));for(let e of this.racers)this.byId.set(e.id,e);this.rebuildStandings()}restart(){this._phase=`countdown`,this._countdown=this.config.countdownDuration,this._shownCount=-1,this._time=0,this._finishedCount=0,this.events.length=0;for(let e of this.racers)e.progress.reset(e.startT),e.finished=!1,e.finishTime=null,e.place=0;this.rebuildStandings()}update(e,t){let n=this._phase===`racing`;n&&(this._time+=e);for(let r of this.racers){let i=t[r.id],a=n&&!r.finished?e:0,o=i===void 0?null:r.progress.update(i,a);o&&this.onLap(r,o)}this._phase===`countdown`&&this.tickCountdown(e),this.rebuildStandings()}tickCountdown(e){this._countdown=Math.max(0,this._countdown-e);let t=Math.ceil(this._countdown);t!==this._shownCount&&(this._shownCount=t,t>0&&this.events.push({type:`countdownTick`,count:t})),this._countdown<=Ua&&(this._phase=`racing`,this.events.push({type:`go`}))}onLap(e,t){this.events.push({type:`lap`,id:e.id,lap:t.lap,time:t.time,best:t.best}),!(e.finished||t.lap<this.config.totalLaps)&&(e.finished=!0,e.finishTime=e.progress.totalTime,this._finishedCount+=1,e.place=this._finishedCount,this.events.push({type:`racerFinished`,id:e.id,place:e.place,totalTime:e.finishTime}),this._phase!==`finished`&&this.allPlayersFinished()&&(this._phase=`finished`,this.events.push({type:`raceFinished`})))}allPlayersFinished(){let e=this.racers.filter(e=>e.isPlayer);return(e.length>0?e:this.racers).every(e=>e.finished)}rebuildStandings(){let e=[...this.racers].sort((e,t)=>e.finished===t.finished?e.finished&&t.finished?e.place-t.place:t.progress.totalProgress-e.progress.totalProgress:e.finished?-1:1);this._standings=e.map((e,t)=>({id:e.id,name:e.name,isPlayer:e.isPlayer,place:t+1,lap:e.progress.lap,totalProgress:e.progress.totalProgress,finished:e.finished,finishTime:e.finishTime}))}isInputLocked(e){return this._phase===`countdown`||this._phase===`finished`?!0:e===void 0?!1:this.byId.get(e)?.finished??!1}gateInput(e,t){return this.isInputLocked(e)?Gt:t}get phase(){return this._phase}get countdown(){return this._countdown}get time(){return this._time}get standings(){return this._standings}get racerCount(){return this.racers.length}getProgress(e){return this.byId.get(e)?.progress}getStanding(e){return this._standings.find(t=>t.id===e)}consumeEvents(){return this.events.length===0?[]:this.events.splice(0,this.events.length)}},Ka={rowSpacing:7,columnOffset:3.4,lineMargin:2,columns:2};function qa(e,t,n={}){let r={...Ka,...n},i=Math.max(1,Math.floor(r.columns)),a=Math.max(1,Math.ceil(t/i)),o=Math.max(e.length,1e-6),s=qn(),c=[];for(let n=0;n<t;n++){let t=Math.floor(n/i),l=n%i,u=Jn((r.lineMargin+(a-1-t)*r.rowSpacing)/o),d=i===1?0:(l-(i-1)/2)*2*r.columnOffset;e.sampleAt(u,s);let f=s.heading;Xn(s,d),c.push({t:u,x:s.x,z:s.z,heading:f,lateral:d})}return c}function Ja(e){if(!Number.isFinite(e)||e<0)return`--.---`;let t=Math.floor(e*1e3+.5),n=t%1e3,r=Math.floor(t/1e3)%60,i=Math.floor(t/6e4),a=String(n).padStart(3,`0`);return i>0?`${i}:${String(r).padStart(2,`0`)}.${a}`:`${r}.${a}`}function Ya(e){return e===null?`--.---`:Ja(e)}var Xa=class e{constructor(t,n,r,i,a=`div`){this.parent=t,this.object=n,this.property=r,this._disabled=!1,this._hidden=!1,this.initialValue=this.getValue(),this.domElement=document.createElement(a),this.domElement.classList.add(`lil-controller`),this.domElement.classList.add(i),this.$name=document.createElement(`div`),this.$name.classList.add(`lil-name`),e.nextNameID=e.nextNameID||0,this.$name.id=`lil-gui-name-${++e.nextNameID}`,this.$widget=document.createElement(`div`),this.$widget.classList.add(`lil-widget`),this.$disable=this.$widget,this.domElement.appendChild(this.$name),this.domElement.appendChild(this.$widget),this.domElement.addEventListener(`keydown`,e=>e.stopPropagation()),this.domElement.addEventListener(`keyup`,e=>e.stopPropagation()),this.parent.children.push(this),this.parent.controllers.push(this),this.parent.$children.appendChild(this.domElement),this._listenCallback=this._listenCallback.bind(this),this.name(r)}name(e){return this._name=e,this.$name.textContent=e,this}onChange(e){return this._onChange=e,this}_callOnChange(){this.parent._callOnChange(this),this._onChange!==void 0&&this._onChange.call(this,this.getValue()),this._changed=!0}onFinishChange(e){return this._onFinishChange=e,this}_callOnFinishChange(){this._changed&&(this.parent._callOnFinishChange(this),this._onFinishChange!==void 0&&this._onFinishChange.call(this,this.getValue())),this._changed=!1}reset(){return this.setValue(this.initialValue),this._callOnFinishChange(),this}enable(e=!0){return this.disable(!e)}disable(e=!0){return e===this._disabled?this:(this._disabled=e,this.domElement.classList.toggle(`lil-disabled`,e),this.$disable.toggleAttribute(`disabled`,e),this)}show(e=!0){return this._hidden=!e,this.domElement.style.display=this._hidden?`none`:``,this}hide(){return this.show(!1)}options(e){let t=this.parent.add(this.object,this.property,e);return t.name(this._name),this.destroy(),t}min(e){return this}max(e){return this}step(e){return this}decimals(e){return this}listen(e=!0){return this._listening=e,this._listenCallbackID!==void 0&&(cancelAnimationFrame(this._listenCallbackID),this._listenCallbackID=void 0),this._listening&&this._listenCallback(),this}_listenCallback(){this._listenCallbackID=requestAnimationFrame(this._listenCallback);let e=this.save();e!==this._listenPrevValue&&this.updateDisplay(),this._listenPrevValue=e}getValue(){return this.object[this.property]}setValue(e){return this.getValue()!==e&&(this.object[this.property]=e,this._callOnChange(),this.updateDisplay()),this}updateDisplay(){return this}load(e){return this.setValue(e),this._callOnFinishChange(),this}save(){return this.getValue()}destroy(){this.listen(!1),this.parent.children.splice(this.parent.children.indexOf(this),1),this.parent.controllers.splice(this.parent.controllers.indexOf(this),1),this.parent.$children.removeChild(this.domElement)}},Za=class extends Xa{constructor(e,t,n){super(e,t,n,`lil-boolean`,`label`),this.$input=document.createElement(`input`),this.$input.setAttribute(`type`,`checkbox`),this.$input.setAttribute(`aria-labelledby`,this.$name.id),this.$widget.appendChild(this.$input),this.$input.addEventListener(`change`,()=>{this.setValue(this.$input.checked),this._callOnFinishChange()}),this.$disable=this.$input,this.updateDisplay()}updateDisplay(){return this.$input.checked=this.getValue(),this}};function Qa(e){let t,n;return(t=e.match(/(#|0x)?([a-f0-9]{6})/i))?n=t[2]:(t=e.match(/rgb\(\s*(\d*)\s*,\s*(\d*)\s*,\s*(\d*)\s*\)/))?n=parseInt(t[1]).toString(16).padStart(2,0)+parseInt(t[2]).toString(16).padStart(2,0)+parseInt(t[3]).toString(16).padStart(2,0):(t=e.match(/^#?([a-f0-9])([a-f0-9])([a-f0-9])$/i))&&(n=t[1]+t[1]+t[2]+t[2]+t[3]+t[3]),n?`#`+n:!1}var $a={isPrimitive:!0,match:e=>typeof e==`string`,fromHexString:Qa,toHexString:Qa},eo={isPrimitive:!0,match:e=>typeof e==`number`,fromHexString:e=>parseInt(e.substring(1),16),toHexString:e=>`#`+e.toString(16).padStart(6,0)},to=[$a,eo,{isPrimitive:!1,match:e=>Array.isArray(e)||ArrayBuffer.isView(e),fromHexString(e,t,n=1){let r=eo.fromHexString(e);t[0]=(r>>16&255)/255*n,t[1]=(r>>8&255)/255*n,t[2]=(r&255)/255*n},toHexString([e,t,n],r=1){r=255/r;let i=e*r<<16^t*r<<8^n*r<<0;return eo.toHexString(i)}},{isPrimitive:!1,match:e=>Object(e)===e,fromHexString(e,t,n=1){let r=eo.fromHexString(e);t.r=(r>>16&255)/255*n,t.g=(r>>8&255)/255*n,t.b=(r&255)/255*n},toHexString({r:e,g:t,b:n},r=1){r=255/r;let i=e*r<<16^t*r<<8^n*r<<0;return eo.toHexString(i)}}];function no(e){return to.find(t=>t.match(e))}var ro=class extends Xa{constructor(e,t,n,r){super(e,t,n,`lil-color`),this.$input=document.createElement(`input`),this.$input.setAttribute(`type`,`color`),this.$input.setAttribute(`tabindex`,-1),this.$input.setAttribute(`aria-labelledby`,this.$name.id),this.$text=document.createElement(`input`),this.$text.setAttribute(`type`,`text`),this.$text.setAttribute(`spellcheck`,`false`),this.$text.setAttribute(`aria-labelledby`,this.$name.id),this.$display=document.createElement(`div`),this.$display.classList.add(`lil-display`),this.$display.appendChild(this.$input),this.$widget.appendChild(this.$display),this.$widget.appendChild(this.$text),this._format=no(this.initialValue),this._rgbScale=r,this._initialValueHexString=this.save(),this._textFocused=!1,this.$input.addEventListener(`input`,()=>{this._setValueFromHexString(this.$input.value)}),this.$input.addEventListener(`blur`,()=>{this._callOnFinishChange()}),this.$text.addEventListener(`input`,()=>{let e=Qa(this.$text.value);e&&this._setValueFromHexString(e)}),this.$text.addEventListener(`focus`,()=>{this._textFocused=!0,this.$text.select()}),this.$text.addEventListener(`blur`,()=>{this._textFocused=!1,this.updateDisplay(),this._callOnFinishChange()}),this.$disable=this.$text,this.updateDisplay()}reset(){return this._setValueFromHexString(this._initialValueHexString),this}_setValueFromHexString(e){if(this._format.isPrimitive){let t=this._format.fromHexString(e);this.setValue(t)}else this._format.fromHexString(e,this.getValue(),this._rgbScale),this._callOnChange(),this.updateDisplay()}save(){return this._format.toHexString(this.getValue(),this._rgbScale)}load(e){return this._setValueFromHexString(e),this._callOnFinishChange(),this}updateDisplay(){return this.$input.value=this._format.toHexString(this.getValue(),this._rgbScale),this._textFocused||(this.$text.value=this.$input.value.substring(1)),this.$display.style.backgroundColor=this.$input.value,this}},io=class extends Xa{constructor(e,t,n){super(e,t,n,`lil-function`),this.$button=document.createElement(`button`),this.$button.appendChild(this.$name),this.$widget.appendChild(this.$button),this.$button.addEventListener(`click`,e=>{e.preventDefault(),this.getValue().call(this.object),this._callOnChange()}),this.$button.addEventListener(`touchstart`,()=>{},{passive:!0}),this.$disable=this.$button}},ao=class extends Xa{constructor(e,t,n,r,i,a){super(e,t,n,`lil-number`),this._initInput(),this.min(r),this.max(i);let o=a!==void 0;this.step(o?a:this._getImplicitStep(),o),this.updateDisplay()}decimals(e){return this._decimals=e,this.updateDisplay(),this}min(e){return this._min=e,this._onUpdateMinMax(),this}max(e){return this._max=e,this._onUpdateMinMax(),this}step(e,t=!0){return this._step=e,this._stepExplicit=t,this}updateDisplay(){let e=this.getValue();if(this._hasSlider){let t=(e-this._min)/(this._max-this._min);t=Math.max(0,Math.min(t,1)),this.$fill.style.width=t*100+`%`}return this._inputFocused||(this.$input.value=this._decimals===void 0?e:e.toFixed(this._decimals)),this}_initInput(){this.$input=document.createElement(`input`),this.$input.setAttribute(`type`,`text`),this.$input.setAttribute(`aria-labelledby`,this.$name.id),window.matchMedia(`(pointer: coarse)`).matches&&(this.$input.setAttribute(`type`,`number`),this.$input.setAttribute(`step`,`any`)),this.$widget.appendChild(this.$input),this.$disable=this.$input;let e=()=>{let e=parseFloat(this.$input.value);isNaN(e)||(this._stepExplicit&&(e=this._snap(e)),this.setValue(this._clamp(e)))},t=e=>{let t=parseFloat(this.$input.value);isNaN(t)||(this._snapClampSetValue(t+e),this.$input.value=this.getValue())},n=e=>{e.key===`Enter`&&this.$input.blur(),e.code===`ArrowUp`&&(e.preventDefault(),t(this._step*this._arrowKeyMultiplier(e))),e.code===`ArrowDown`&&(e.preventDefault(),t(this._step*this._arrowKeyMultiplier(e)*-1))},r=e=>{this._inputFocused&&(e.preventDefault(),t(this._step*this._normalizeMouseWheel(e)))},i=!1,a,o,s,c,l,u=e=>{a=e.clientX,o=s=e.clientY,i=!0,c=this.getValue(),l=0,window.addEventListener(`mousemove`,d),window.addEventListener(`mouseup`,f)},d=e=>{if(i){let t=e.clientX-a,n=e.clientY-o;Math.abs(n)>5?(e.preventDefault(),this.$input.blur(),i=!1,this._setDraggingStyle(!0,`vertical`)):Math.abs(t)>5&&f()}if(!i){let t=e.clientY-s;l-=t*this._step*this._arrowKeyMultiplier(e),c+l>this._max?l=this._max-c:c+l<this._min&&(l=this._min-c),this._snapClampSetValue(c+l)}s=e.clientY},f=()=>{this._setDraggingStyle(!1,`vertical`),this._callOnFinishChange(),window.removeEventListener(`mousemove`,d),window.removeEventListener(`mouseup`,f)};this.$input.addEventListener(`input`,e),this.$input.addEventListener(`keydown`,n),this.$input.addEventListener(`wheel`,r,{passive:!1}),this.$input.addEventListener(`mousedown`,u),this.$input.addEventListener(`focus`,()=>{this._inputFocused=!0}),this.$input.addEventListener(`blur`,()=>{this._inputFocused=!1,this.updateDisplay(),this._callOnFinishChange()})}_initSlider(){this._hasSlider=!0,this.$slider=document.createElement(`div`),this.$slider.classList.add(`lil-slider`),this.$fill=document.createElement(`div`),this.$fill.classList.add(`lil-fill`),this.$slider.appendChild(this.$fill),this.$widget.insertBefore(this.$slider,this.$input),this.domElement.classList.add(`lil-has-slider`);let e=(e,t,n,r,i)=>(e-t)/(n-t)*(i-r)+r,t=t=>{let n=this.$slider.getBoundingClientRect(),r=e(t,n.left,n.right,this._min,this._max);this._snapClampSetValue(r)},n=e=>{this._setDraggingStyle(!0),t(e.clientX),window.addEventListener(`mousemove`,r),window.addEventListener(`mouseup`,i)},r=e=>{t(e.clientX)},i=()=>{this._callOnFinishChange(),this._setDraggingStyle(!1),window.removeEventListener(`mousemove`,r),window.removeEventListener(`mouseup`,i)},a=!1,o,s,c=e=>{e.preventDefault(),this._setDraggingStyle(!0),t(e.touches[0].clientX),a=!1},l=e=>{e.touches.length>1||(this._hasScrollBar?(o=e.touches[0].clientX,s=e.touches[0].clientY,a=!0):c(e),window.addEventListener(`touchmove`,u,{passive:!1}),window.addEventListener(`touchend`,d))},u=e=>{if(a){let t=e.touches[0].clientX-o,n=e.touches[0].clientY-s;Math.abs(t)>Math.abs(n)?c(e):(window.removeEventListener(`touchmove`,u),window.removeEventListener(`touchend`,d))}else e.preventDefault(),t(e.touches[0].clientX)},d=()=>{this._callOnFinishChange(),this._setDraggingStyle(!1),window.removeEventListener(`touchmove`,u),window.removeEventListener(`touchend`,d)},f=this._callOnFinishChange.bind(this),p;this.$slider.addEventListener(`mousedown`,n),this.$slider.addEventListener(`touchstart`,l,{passive:!1}),this.$slider.addEventListener(`wheel`,e=>{if(Math.abs(e.deltaX)<Math.abs(e.deltaY)&&this._hasScrollBar)return;e.preventDefault();let t=this._normalizeMouseWheel(e)*this._step;this._snapClampSetValue(this.getValue()+t),this.$input.value=this.getValue(),clearTimeout(p),p=setTimeout(f,400)},{passive:!1})}_setDraggingStyle(e,t=`horizontal`){this.$slider&&this.$slider.classList.toggle(`lil-active`,e),document.body.classList.toggle(`lil-dragging`,e),document.body.classList.toggle(`lil-${t}`,e)}_getImplicitStep(){return this._hasMin&&this._hasMax?(this._max-this._min)/1e3:.1}_onUpdateMinMax(){!this._hasSlider&&this._hasMin&&this._hasMax&&(this._stepExplicit||this.step(this._getImplicitStep(),!1),this._initSlider(),this.updateDisplay())}_normalizeMouseWheel(e){let{deltaX:t,deltaY:n}=e;return Math.floor(e.deltaY)!==e.deltaY&&e.wheelDelta&&(t=0,n=-e.wheelDelta/120,n*=this._stepExplicit?1:10),t+-n}_arrowKeyMultiplier(e){let t=this._stepExplicit?1:10;return e.shiftKey?t*=10:e.altKey&&(t/=10),t}_snap(e){let t=0;return this._hasMin?t=this._min:this._hasMax&&(t=this._max),e-=t,e=Math.round(e/this._step)*this._step,e+=t,e=parseFloat(e.toPrecision(15)),e}_clamp(e){return e<this._min&&(e=this._min),e>this._max&&(e=this._max),e}_snapClampSetValue(e){this.setValue(this._clamp(this._snap(e)))}get _hasScrollBar(){let e=this.parent.root.$children;return e.scrollHeight>e.clientHeight}get _hasMin(){return this._min!==void 0}get _hasMax(){return this._max!==void 0}},oo=class extends Xa{constructor(e,t,n,r){super(e,t,n,`lil-option`),this.$select=document.createElement(`select`),this.$select.setAttribute(`aria-labelledby`,this.$name.id),this.$display=document.createElement(`div`),this.$display.classList.add(`lil-display`),this.$select.addEventListener(`change`,()=>{this.setValue(this._values[this.$select.selectedIndex]),this._callOnFinishChange()}),this.$select.addEventListener(`focus`,()=>{this.$display.classList.add(`lil-focus`)}),this.$select.addEventListener(`blur`,()=>{this.$display.classList.remove(`lil-focus`)}),this.$widget.appendChild(this.$select),this.$widget.appendChild(this.$display),this.$disable=this.$select,this.options(r)}options(e){return this._values=Array.isArray(e)?e:Object.values(e),this._names=Array.isArray(e)?e:Object.keys(e),this.$select.replaceChildren(),this._names.forEach(e=>{let t=document.createElement(`option`);t.textContent=e,this.$select.appendChild(t)}),this.updateDisplay(),this}updateDisplay(){let e=this.getValue(),t=this._values.indexOf(e);return this.$select.selectedIndex=t,this.$display.textContent=t===-1?e:this._names[t],this}},so=class extends Xa{constructor(e,t,n){super(e,t,n,`lil-string`),this.$input=document.createElement(`input`),this.$input.setAttribute(`type`,`text`),this.$input.setAttribute(`spellcheck`,`false`),this.$input.setAttribute(`aria-labelledby`,this.$name.id),this.$input.addEventListener(`input`,()=>{this.setValue(this.$input.value)}),this.$input.addEventListener(`keydown`,e=>{e.code===`Enter`&&this.$input.blur()}),this.$input.addEventListener(`blur`,()=>{this._callOnFinishChange()}),this.$widget.appendChild(this.$input),this.$disable=this.$input,this.updateDisplay()}updateDisplay(){return this.$input.value=this.getValue(),this}},co=`.lil-gui {
  font-family: var(--font-family);
  font-size: var(--font-size);
  line-height: 1;
  font-weight: normal;
  font-style: normal;
  text-align: left;
  color: var(--text-color);
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  --background-color: #1f1f1f;
  --text-color: #ebebeb;
  --title-background-color: #111111;
  --title-text-color: #ebebeb;
  --widget-color: #424242;
  --hover-color: #4f4f4f;
  --focus-color: #595959;
  --number-color: #2cc9ff;
  --string-color: #a2db3c;
  --font-size: 11px;
  --input-font-size: 11px;
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  --font-family-mono: Menlo, Monaco, Consolas, "Droid Sans Mono", monospace;
  --padding: 4px;
  --spacing: 4px;
  --widget-height: 20px;
  --title-height: calc(var(--widget-height) + var(--spacing) * 1.25);
  --name-width: 45%;
  --slider-knob-width: 2px;
  --slider-input-width: 27%;
  --color-input-width: 27%;
  --slider-input-min-width: 45px;
  --color-input-min-width: 45px;
  --folder-indent: 7px;
  --widget-padding: 0 0 0 3px;
  --widget-border-radius: 2px;
  --checkbox-size: calc(0.75 * var(--widget-height));
  --scrollbar-width: 5px;
}
.lil-gui, .lil-gui * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
.lil-gui.lil-root {
  width: var(--width, 245px);
  display: flex;
  flex-direction: column;
  background: var(--background-color);
}
.lil-gui.lil-root > .lil-title {
  background: var(--title-background-color);
  color: var(--title-text-color);
}
.lil-gui.lil-root > .lil-children {
  overflow-x: hidden;
  overflow-y: auto;
}
.lil-gui.lil-root > .lil-children::-webkit-scrollbar {
  width: var(--scrollbar-width);
  height: var(--scrollbar-width);
  background: var(--background-color);
}
.lil-gui.lil-root > .lil-children::-webkit-scrollbar-thumb {
  border-radius: var(--scrollbar-width);
  background: var(--focus-color);
}
@media (pointer: coarse) {
  .lil-gui.lil-allow-touch-styles, .lil-gui.lil-allow-touch-styles .lil-gui {
    --widget-height: 28px;
    --padding: 6px;
    --spacing: 6px;
    --font-size: 13px;
    --input-font-size: 16px;
    --folder-indent: 10px;
    --scrollbar-width: 7px;
    --slider-input-min-width: 50px;
    --color-input-min-width: 65px;
  }
}
.lil-gui.lil-force-touch-styles, .lil-gui.lil-force-touch-styles .lil-gui {
  --widget-height: 28px;
  --padding: 6px;
  --spacing: 6px;
  --font-size: 13px;
  --input-font-size: 16px;
  --folder-indent: 10px;
  --scrollbar-width: 7px;
  --slider-input-min-width: 50px;
  --color-input-min-width: 65px;
}
.lil-gui.lil-auto-place, .lil-gui.autoPlace {
  max-height: 100%;
  position: fixed;
  top: 0;
  right: 15px;
  z-index: 1001;
}

.lil-controller {
  display: flex;
  align-items: center;
  padding: 0 var(--padding);
  margin: var(--spacing) 0;
}
.lil-controller.lil-disabled {
  opacity: 0.5;
}
.lil-controller.lil-disabled, .lil-controller.lil-disabled * {
  pointer-events: none !important;
}
.lil-controller > .lil-name {
  min-width: var(--name-width);
  flex-shrink: 0;
  white-space: pre;
  padding-right: var(--spacing);
  line-height: var(--widget-height);
}
.lil-controller .lil-widget {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--widget-height);
}
.lil-controller.lil-string input {
  color: var(--string-color);
}
.lil-controller.lil-boolean {
  cursor: pointer;
}
.lil-controller.lil-color .lil-display {
  width: 100%;
  height: var(--widget-height);
  border-radius: var(--widget-border-radius);
  position: relative;
}
@media (hover: hover) {
  .lil-controller.lil-color .lil-display:hover:before {
    content: " ";
    display: block;
    position: absolute;
    border-radius: var(--widget-border-radius);
    border: 1px solid #fff9;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
  }
}
.lil-controller.lil-color input[type=color] {
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}
.lil-controller.lil-color input[type=text] {
  margin-left: var(--spacing);
  font-family: var(--font-family-mono);
  min-width: var(--color-input-min-width);
  width: var(--color-input-width);
  flex-shrink: 0;
}
.lil-controller.lil-option select {
  opacity: 0;
  position: absolute;
  width: 100%;
  max-width: 100%;
}
.lil-controller.lil-option .lil-display {
  position: relative;
  pointer-events: none;
  border-radius: var(--widget-border-radius);
  height: var(--widget-height);
  line-height: var(--widget-height);
  max-width: 100%;
  overflow: hidden;
  word-break: break-all;
  padding-left: 0.55em;
  padding-right: 1.75em;
  background: var(--widget-color);
}
@media (hover: hover) {
  .lil-controller.lil-option .lil-display.lil-focus {
    background: var(--focus-color);
  }
}
.lil-controller.lil-option .lil-display.lil-active {
  background: var(--focus-color);
}
.lil-controller.lil-option .lil-display:after {
  font-family: "lil-gui";
  content: "↕";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  padding-right: 0.375em;
}
.lil-controller.lil-option .lil-widget,
.lil-controller.lil-option select {
  cursor: pointer;
}
@media (hover: hover) {
  .lil-controller.lil-option .lil-widget:hover .lil-display {
    background: var(--hover-color);
  }
}
.lil-controller.lil-number input {
  color: var(--number-color);
}
.lil-controller.lil-number.lil-has-slider input {
  margin-left: var(--spacing);
  width: var(--slider-input-width);
  min-width: var(--slider-input-min-width);
  flex-shrink: 0;
}
.lil-controller.lil-number .lil-slider {
  width: 100%;
  height: var(--widget-height);
  background: var(--widget-color);
  border-radius: var(--widget-border-radius);
  padding-right: var(--slider-knob-width);
  overflow: hidden;
  cursor: ew-resize;
  touch-action: pan-y;
}
@media (hover: hover) {
  .lil-controller.lil-number .lil-slider:hover {
    background: var(--hover-color);
  }
}
.lil-controller.lil-number .lil-slider.lil-active {
  background: var(--focus-color);
}
.lil-controller.lil-number .lil-slider.lil-active .lil-fill {
  opacity: 0.95;
}
.lil-controller.lil-number .lil-fill {
  height: 100%;
  border-right: var(--slider-knob-width) solid var(--number-color);
  box-sizing: content-box;
}

.lil-dragging .lil-gui {
  --hover-color: var(--widget-color);
}
.lil-dragging * {
  cursor: ew-resize !important;
}
.lil-dragging.lil-vertical * {
  cursor: ns-resize !important;
}

.lil-gui .lil-title {
  height: var(--title-height);
  font-weight: 600;
  padding: 0 var(--padding);
  width: 100%;
  text-align: left;
  background: none;
  text-decoration-skip: objects;
}
.lil-gui .lil-title:before {
  font-family: "lil-gui";
  content: "▾";
  padding-right: 2px;
  display: inline-block;
}
.lil-gui .lil-title:active {
  background: var(--title-background-color);
  opacity: 0.75;
}
@media (hover: hover) {
  body:not(.lil-dragging) .lil-gui .lil-title:hover {
    background: var(--title-background-color);
    opacity: 0.85;
  }
  .lil-gui .lil-title:focus {
    text-decoration: underline var(--focus-color);
  }
}
.lil-gui.lil-root > .lil-title:focus {
  text-decoration: none !important;
}
.lil-gui.lil-closed > .lil-title:before {
  content: "▸";
}
.lil-gui.lil-closed > .lil-children {
  transform: translateY(-7px);
  opacity: 0;
}
.lil-gui.lil-closed:not(.lil-transition) > .lil-children {
  display: none;
}
.lil-gui.lil-transition > .lil-children {
  transition-duration: 300ms;
  transition-property: height, opacity, transform;
  transition-timing-function: cubic-bezier(0.2, 0.6, 0.35, 1);
  overflow: hidden;
  pointer-events: none;
}
.lil-gui .lil-children:empty:before {
  content: "Empty";
  padding: 0 var(--padding);
  margin: var(--spacing) 0;
  display: block;
  height: var(--widget-height);
  font-style: italic;
  line-height: var(--widget-height);
  opacity: 0.5;
}
.lil-gui.lil-root > .lil-children > .lil-gui > .lil-title {
  border: 0 solid var(--widget-color);
  border-width: 1px 0;
  transition: border-color 300ms;
}
.lil-gui.lil-root > .lil-children > .lil-gui.lil-closed > .lil-title {
  border-bottom-color: transparent;
}
.lil-gui + .lil-controller {
  border-top: 1px solid var(--widget-color);
  margin-top: 0;
  padding-top: var(--spacing);
}
.lil-gui .lil-gui .lil-gui > .lil-title {
  border: none;
}
.lil-gui .lil-gui .lil-gui > .lil-children {
  border: none;
  margin-left: var(--folder-indent);
  border-left: 2px solid var(--widget-color);
}
.lil-gui .lil-gui .lil-controller {
  border: none;
}

.lil-gui label, .lil-gui input, .lil-gui button {
  -webkit-tap-highlight-color: transparent;
}
.lil-gui input {
  border: 0;
  outline: none;
  font-family: var(--font-family);
  font-size: var(--input-font-size);
  border-radius: var(--widget-border-radius);
  height: var(--widget-height);
  background: var(--widget-color);
  color: var(--text-color);
  width: 100%;
}
@media (hover: hover) {
  .lil-gui input:hover {
    background: var(--hover-color);
  }
  .lil-gui input:active {
    background: var(--focus-color);
  }
}
.lil-gui input:disabled {
  opacity: 1;
}
.lil-gui input[type=text],
.lil-gui input[type=number] {
  padding: var(--widget-padding);
  -moz-appearance: textfield;
}
.lil-gui input[type=text]:focus,
.lil-gui input[type=number]:focus {
  background: var(--focus-color);
}
.lil-gui input[type=checkbox] {
  appearance: none;
  width: var(--checkbox-size);
  height: var(--checkbox-size);
  border-radius: var(--widget-border-radius);
  text-align: center;
  cursor: pointer;
}
.lil-gui input[type=checkbox]:checked:before {
  font-family: "lil-gui";
  content: "✓";
  font-size: var(--checkbox-size);
  line-height: var(--checkbox-size);
}
@media (hover: hover) {
  .lil-gui input[type=checkbox]:focus {
    box-shadow: inset 0 0 0 1px var(--focus-color);
  }
}
.lil-gui button {
  outline: none;
  cursor: pointer;
  font-family: var(--font-family);
  font-size: var(--font-size);
  color: var(--text-color);
  width: 100%;
  border: none;
}
.lil-gui .lil-controller button {
  height: var(--widget-height);
  text-transform: none;
  background: var(--widget-color);
  border-radius: var(--widget-border-radius);
}
@media (hover: hover) {
  .lil-gui .lil-controller button:hover {
    background: var(--hover-color);
  }
  .lil-gui .lil-controller button:focus {
    box-shadow: inset 0 0 0 1px var(--focus-color);
  }
}
.lil-gui .lil-controller button:active {
  background: var(--focus-color);
}

@font-face {
  font-family: "lil-gui";
  src: url("data:application/font-woff2;charset=utf-8;base64,d09GMgABAAAAAALkAAsAAAAABtQAAAKVAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHFQGYACDMgqBBIEbATYCJAMUCwwABCAFhAoHgQQbHAbIDiUFEYVARAAAYQTVWNmz9MxhEgodq49wYRUFKE8GWNiUBxI2LBRaVnc51U83Gmhs0Q7JXWMiz5eteLwrKwuxHO8VFxUX9UpZBs6pa5ABRwHA+t3UxUnH20EvVknRerzQgX6xC/GH6ZUvTcAjAv122dF28OTqCXrPuyaDER30YBA1xnkVutDDo4oCi71Ca7rrV9xS8dZHbPHefsuwIyCpmT7j+MnjAH5X3984UZoFFuJ0yiZ4XEJFxjagEBeqs+e1iyK8Xf/nOuwF+vVK0ur765+vf7txotUi0m3N0m/84RGSrBCNrh8Ee5GjODjF4gnWP+dJrH/Lk9k4oT6d+gr6g/wssA2j64JJGP6cmx554vUZnpZfn6ZfX2bMwPPrlANsB86/DiHjhl0OP+c87+gaJo/gY084s3HoYL/ZkWHTRfBXvvoHnnkHvngKun4KBE/ede7tvq3/vQOxDXB1/fdNz6XbPdcr0Vhpojj9dG+owuSKFsslCi1tgEjirjXdwMiov2EioadxmqTHUCIwo8NgQaeIasAi0fTYSPTbSmwbMOFduyh9wvBrESGY0MtgRjtgQR8Q1bRPohn2UoCRZf9wyYANMXFeJTysqAe0I4mrherOekFdKMrYvJjLvOIUM9SuwYB5DVZUwwVjJJOaUnZCmcEkIZZrKqNvRGRMvmFZsmhP4VMKCSXBhSqUBxgMS7h0cZvEd71AWkEhGWaeMFcNnpqyJkyXgYL7PQ1MoSq0wDAkRtJIijkZSmqYTiSImfLiSWXIZwhRh3Rug2X0kk1Dgj+Iu43u5p98ghopcpSo0Uyc8SnjlYX59WUeaMoDqmVD2TOWD9a4pCRAzf2ECgwGcrHjPOWY9bNxq/OL3I/QjwEAAAA=") format("woff2");
}`;function lo(e){let t=document.createElement(`style`);t.innerHTML=e;let n=document.querySelector(`head link[rel=stylesheet], head style`);n?document.head.insertBefore(t,n):document.head.appendChild(t)}var uo=!1,fo=class e{constructor({parent:e,autoPlace:t=e===void 0,container:n,width:r,title:i=`Controls`,closeFolders:a=!1,injectStyles:o=!0,touchStyles:s=!0}={}){if(this.parent=e,this.root=e?e.root:this,this.children=[],this.controllers=[],this.folders=[],this._closed=!1,this._hidden=!1,this.domElement=document.createElement(`div`),this.domElement.classList.add(`lil-gui`),this.$title=document.createElement(`button`),this.$title.classList.add(`lil-title`),this.$title.setAttribute(`aria-expanded`,!0),this.$title.addEventListener(`click`,()=>this.openAnimated(this._closed)),this.$title.addEventListener(`touchstart`,()=>{},{passive:!0}),this.$children=document.createElement(`div`),this.$children.classList.add(`lil-children`),this.domElement.appendChild(this.$title),this.domElement.appendChild(this.$children),this.title(i),this.parent){this.parent.children.push(this),this.parent.folders.push(this),this.parent.$children.appendChild(this.domElement);return}this.domElement.classList.add(`lil-root`),s&&this.domElement.classList.add(`lil-allow-touch-styles`),!uo&&o&&(lo(co),uo=!0),n?n.appendChild(this.domElement):t&&(this.domElement.classList.add(`lil-auto-place`,`autoPlace`),document.body.appendChild(this.domElement)),r&&this.domElement.style.setProperty(`--width`,r+`px`),this._closeFolders=a}add(e,t,n,r,i){if(Object(n)===n)return new oo(this,e,t,n);let a=e[t];switch(typeof a){case`number`:return new ao(this,e,t,n,r,i);case`boolean`:return new Za(this,e,t);case`string`:return new so(this,e,t);case`function`:return new io(this,e,t)}console.error(`gui.add failed
	property:`,t,`
	object:`,e,`
	value:`,a)}addColor(e,t,n=1){return new ro(this,e,t,n)}addFolder(t){let n=new e({parent:this,title:t});return this.root._closeFolders&&n.close(),n}load(e,t=!0){return e.controllers&&this.controllers.forEach(t=>{t instanceof io||t._name in e.controllers&&t.load(e.controllers[t._name])}),t&&e.folders&&this.folders.forEach(t=>{t._title in e.folders&&t.load(e.folders[t._title])}),this}save(e=!0){let t={controllers:{},folders:{}};return this.controllers.forEach(e=>{if(!(e instanceof io)){if(e._name in t.controllers)throw Error(`Cannot save GUI with duplicate property "${e._name}"`);t.controllers[e._name]=e.save()}}),e&&this.folders.forEach(e=>{if(e._title in t.folders)throw Error(`Cannot save GUI with duplicate folder "${e._title}"`);t.folders[e._title]=e.save()}),t}open(e=!0){return this._setClosed(!e),this.$title.setAttribute(`aria-expanded`,!this._closed),this.domElement.classList.toggle(`lil-closed`,this._closed),this}close(){return this.open(!1)}_setClosed(e){this._closed!==e&&(this._closed=e,this._callOnOpenClose(this))}show(e=!0){return this._hidden=!e,this.domElement.style.display=this._hidden?`none`:``,this}hide(){return this.show(!1)}openAnimated(e=!0){return this._setClosed(!e),this.$title.setAttribute(`aria-expanded`,!this._closed),requestAnimationFrame(()=>{let t=this.$children.clientHeight;this.$children.style.height=t+`px`,this.domElement.classList.add(`lil-transition`);let n=e=>{e.target===this.$children&&(this.$children.style.height=``,this.domElement.classList.remove(`lil-transition`),this.$children.removeEventListener(`transitionend`,n))};this.$children.addEventListener(`transitionend`,n);let r=e?this.$children.scrollHeight:0;this.domElement.classList.toggle(`lil-closed`,!e),requestAnimationFrame(()=>{this.$children.style.height=r+`px`})}),this}title(e){return this._title=e,this.$title.textContent=e,this}reset(e=!0){return(e?this.controllersRecursive():this.controllers).forEach(e=>e.reset()),this}onChange(e){return this._onChange=e,this}_callOnChange(e){this.parent&&this.parent._callOnChange(e),this._onChange!==void 0&&this._onChange.call(this,{object:e.object,property:e.property,value:e.getValue(),controller:e})}onFinishChange(e){return this._onFinishChange=e,this}_callOnFinishChange(e){this.parent&&this.parent._callOnFinishChange(e),this._onFinishChange!==void 0&&this._onFinishChange.call(this,{object:e.object,property:e.property,value:e.getValue(),controller:e})}onOpenClose(e){return this._onOpenClose=e,this}_callOnOpenClose(e){this.parent&&this.parent._callOnOpenClose(e),this._onOpenClose!==void 0&&this._onOpenClose.call(this,e)}destroy(){this.parent&&(this.parent.children.splice(this.parent.children.indexOf(this),1),this.parent.folders.splice(this.parent.folders.indexOf(this),1)),this.domElement.parentElement&&this.domElement.parentElement.removeChild(this.domElement),Array.from(this.children).forEach(e=>e.destroy())}controllersRecursive(){let e=Array.from(this.controllers);return this.folders.forEach(t=>{e=e.concat(t.controllersRecursive())}),e}foldersRecursive(){let e=Array.from(this.folders);return this.folders.forEach(t=>{e=e.concat(t.foldersRecursive())}),e}},po={radius:2.4,respawnDelay:2.5},mo={radius:[.5,8,.1],respawnDelay:[.5,20,.5]},ho=3,go=1.2,_o=class{boxes;config;constructor(e,t={}){this.config={...po,...t},this.boxes=e.map((e,t)=>({index:t,x:e.x,y:e.y,z:e.z,active:!0,respawnIn:0}))}reset(){for(let e of this.boxes)e.active=!0,e.respawnIn=0}update(e,t,n=[]){if(n.length=0,e<=0)return n;for(let t of this.boxes)t.active||(t.respawnIn-=e,t.respawnIn<=0&&(t.active=!0,t.respawnIn=0));let r=this.config.radius+go,i=r*r,a=new Set;for(let e of this.boxes)if(e.active)for(let r of t){if(a.has(r.id)||Math.abs(r.y-e.y)>ho)continue;let t=r.x-e.x,o=r.z-e.z;if(!(t*t+o*o>i)){e.active=!1,e.respawnIn=this.config.respawnDelay,a.add(r.id),n.push({pickerId:r.id,boxIndex:e.index});break}}return n}};function vo(e,t,n=0){return{type:e,duration:t,magnitude:n}}var yo=.12,bo=class{effects=new Map;add(e){if(e.duration<=0)return;let t=this.effects.get(e.type);if(!t){this.effects.set(e.type,{...e});return}t.duration=Math.max(t.duration,e.duration),t.magnitude=Math.max(t.magnitude,e.magnitude)}update(e){if(!(e<=0))for(let[t,n]of this.effects)n.duration-=e,n.duration<=0&&this.effects.delete(t)}has(e){return this.effects.has(e)}get(e){return this.effects.get(e)}remaining(e){return this.effects.get(e)?.duration??0}remove(e){this.effects.delete(e)}clear(){this.effects.clear()}get size(){return this.effects.size}list(){return[...this.effects.values()]}consumeShield(){return this.effects.has(`shield`)?(this.effects.delete(`shield`),!0):!1}applyTo(e){if(this.effects.size===0)return;let t=this.effects.get(`boost`);t&&(e.maxSpeed*=1+t.magnitude,e.engineAccel*=1+t.magnitude);let n=Math.max(this.effects.get(`slow`)?.magnitude??0,this.effects.get(`spinout`)?.magnitude??0);if(n>0){let t=Math.max(1-n,.05);e.maxSpeed*=t,e.engineAccel*=t}let r=this.effects.get(`spinout`);if(r){let t=Math.max(1-r.magnitude,yo);e.turnRate*=t,e.driftTurnRate*=t,e.driftMinSpeed=1/0}}},xo={boost:{id:`boost`,name:`加速`,rarity:`common`,targetType:`self`,color:`#ffb020`,icon:`»`,offensive:!1,apply:()=>({grantBoost:{level:3,duration:1.6}})},projectile:{id:`projectile`,name:`飞弹`,rarity:`common`,targetType:`forward`,color:`#3fc4ff`,icon:`●`,offensive:!0,apply:()=>({spawnProjectile:{speed:52,life:5,radius:2.2,homing:!0,onHit:[vo(`spinout`,1.5,.65)]}})},shield:{id:`shield`,name:`护盾`,rarity:`common`,targetType:`self`,color:`#7cf7c4`,icon:`◇`,offensive:!1,apply:()=>({selfEffects:[vo(`shield`,8)]})},trap:{id:`trap`,name:`地雷`,rarity:`common`,targetType:`self`,color:`#ff5fa2`,icon:`▲`,offensive:!0,apply:()=>({spawnTrap:{radius:2.4,life:25,armDelay:.6,dropBack:4.5,ownerGrace:2.5,onHit:[vo(`spinout`,1.2,.6)]}})},lightning:{id:`lightning`,name:`闪电`,rarity:`rare`,targetType:`allOthers`,color:`#e8d64a`,icon:`⚡`,offensive:!0,apply:()=>({targetEffects:[vo(`slow`,3.5,.45)]})}},So=Object.keys(xo);So.map(e=>xo[e]);var Co=[{label:`领跑`,maxPlaceRatio:0,weights:{shield:50,trap:45,boost:5}},{label:`前段`,maxPlaceRatio:.34,weights:{shield:34,trap:34,boost:20,projectile:12}},{label:`中段`,maxPlaceRatio:.67,weights:{shield:18,trap:20,boost:26,projectile:32,lightning:4}},{label:`后段`,maxPlaceRatio:.99,weights:{shield:8,trap:8,boost:34,projectile:34,lightning:16}},{label:`末位`,maxPlaceRatio:1,weights:{shield:4,trap:4,boost:34,projectile:28,lightning:30}}];function wo(e,t){let n=Co[Co.length-1];if(t<=1)return Co[0];let r=(Math.min(Math.max(e,1),t)-1)/(t-1);for(let e of Co)if(r<=e.maxPlaceRatio+1e-9)return e;return n}function To(e,t){let{weights:n}=wo(e,t),r=0;for(let e of So)r+=n[e]??0;let i={};for(let e of So)i[e]=r>0?(n[e]??0)/r:0;return i}function Eo(e,t,n){let{weights:r}=wo(e,t);return $n(So.map(e=>[e,r[e]??0]),n)??`shield`}var Do={turnRate:2.4,lookAhead:14,maxLockAngle:1.4,homingWeight:.62,hoverHeight:.95},Oo={turnRate:[.2,10,.05],lookAhead:[2,50,.5],maxLockAngle:[.2,3.14,.02],homingWeight:[0,1,.01],hoverHeight:[0,3,.05]},ko=1.2,Ao=3;function jo(e,t,n,r=.25){let i=null,a=1/0;for(let o of n){if(o.id===t)continue;let n=Jn(o.trackT-e);n<=0||n>r||n<a&&(a=n,i=o.id)}return i}function Mo(e,t,n,r=.25){let i=null,a=1/0;for(let o of n){if(o.id===t)continue;let n=Jn(e-o.trackT);n<=0||n>r||n<a&&(a=n,i=o.id)}return i}var No=qn();function Po(e,t,n,r,i,a){if(a<=0)return{kind:`alive`};if(e.life-=a,e.life<=0)return{kind:`expired`};if(e.homing){let o=Jn(t+i.lookAhead/Math.max(n.length,1e-6)),s=n.sampleAt(o,No),c=Math.atan2(s.x-e.x,s.z-e.z),l=e.targetId?r.find(t=>t.id===e.targetId):void 0;if(l){let t=Yn(Math.atan2(l.x-e.x,l.z-e.z)-c);Math.abs(t)<=i.maxLockAngle?c+=t*i.homingWeight:e.targetId=null}let u=Yn(c-e.heading),d=i.turnRate*a;e.heading+=Math.abs(u)<=d?u:Math.sign(u)*d}e.x+=Math.sin(e.heading)*e.speed*a,e.z+=Math.cos(e.heading)*e.speed*a;let o=e.radius+ko;for(let t of r){if(t.id===e.ownerId||Math.abs(t.y-e.y)>Ao)continue;let n=t.x-e.x,r=t.z-e.z;if(n*n+r*r<=o*o)return{kind:`hit`,targetId:t.id}}return{kind:`alive`}}function Fo(e,t,n){if(n<=0)return{hitId:null,done:!1};if(e.life-=n,e.life<=0)return{hitId:null,done:!0};if(e.ownerGrace>0&&(e.ownerGrace-=n),e.armDelay>0)return e.armDelay-=n,{hitId:null,done:!1};let r=e.radius+ko;for(let n of t){if(n.id===e.ownerId&&e.ownerGrace>0||Math.abs(n.y-e.y)>Ao)continue;let t=n.x-e.x,i=n.z-e.z;if(t*t+i*i<=r*r)return{hitId:n.id,done:!0}}return{hitId:null,done:!1}}function Io(){return{showCenterLine:!1,progress:0,lateral:0,airborne:!1}}function Lo(){return{phase:`countdown`,lap:`1/3`,sector:0,lapValid:!0,bestLap:`--`,record:`--`}}function Ro(e,t=`normal`){return{difficulty:t,rubberband:!0,count:e,leaderSpeedMul:1,gapToPlayer:0}}function zo(){return{held:`—`,effects:`—`,entities:`0 / 0`,chances:`—`,forceItem:`boost`}}function Bo(e){return{tier:e,fps:0,drawCalls:0,triangles:0,pixelRatio:1,budget:`drawcall ≤ ${Ye.drawCalls} · 三角面 ≤ ${Ye.triangles/1e3}k`,particles:`0 / 0 / 0`,audioFallback:`—`,autoAdapt:!0}}var Vo=class{targets;gui=new fo({title:`手感调参`});visible=!0;constructor(e){this.targets=e;let t=this.gui.addFolder(`车辆手感`);for(let n of[`maxSpeed`,`maxReverseSpeed`,`engineAccel`,`reverseAccel`,`brakeDecel`,`coastFriction`])this.addScalar(t,e.kart,n);let n=this.gui.addFolder(`转向`);for(let t of[`turnRate`,`steerAuthoritySpeed`,`highSpeedSteerFactor`,`steerSmoothing`,`corneringDrag`])this.addScalar(n,e.kart,t);let r=this.gui.addFolder(`漂移`);for(let t of[`driftMinSpeed`,`driftSteerDeadzone`,`driftYaw`,`driftYawSmoothing`,`driftTurnRate`,`driftCounterSteer`,`driftFriction`])this.addScalar(r,e.kart,t);let i=this.gui.addFolder(`地形贴合 / 护栏`);for(let t of[`groundStickSmoothing`,`groundNormalSmoothing`,`gravity`,`respawnDelay`,`wallDecel`])this.addScalar(i,e.kart,t);let a=this.gui.addFolder(`蓄力 / Mini-Turbo`);this.addTriple(a,e.kart,`chargeThresholds`),this.addTriple(a,e.kart,`boostSpeedMul`),this.addTriple(a,e.kart,`boostDuration`),this.addScalar(a,e.kart,`boostAccelMul`),this.addScalar(a,e.kart,`boostFalloffDecel`),this.section(`车车碰撞`,e.collision,Tn),this.section(`跟随相机`,e.camera,Dr),this.section(`车身视觉`,e.view,Ur);let o=this.gui.addFolder(`赛道`);o.add(e.track,`showCenterLine`).name(`显示中心线`),o.add(e.track,`progress`).name(`进度 t`).listen().disable(),o.add(e.track,`lateral`).name(`横向偏移 (m)`).listen().disable(),o.add(e.track,`airborne`).name(`掉出赛道`).listen().disable();let s=this.gui.addFolder(`比赛`);s.add(e.race,`phase`).name(`阶段`).listen().disable(),s.add(e.race,`lap`).name(`圈数`).listen().disable(),s.add(e.race,`sector`).name(`最近 checkpoint`).listen().disable(),s.add(e.race,`lapValid`).name(`本圈有效`).listen().disable(),s.add(e.race,`bestLap`).name(`本局最佳`).listen().disable(),s.add(e.race,`record`).name(`本地纪录`).listen().disable(),s.add({clear:e.onClearRecord},`clear`).name(`清除本地纪录`);let c=this.gui.addFolder(`AI 对手`);c.add(e.ai,`count`).name(`对手数量`).listen().disable(),c.add(e.ai,`difficulty`,[...mt]).name(`难度`).onChange(e.onAIChanged),c.add(e.ai,`rubberband`).name(`橡皮筋`).onChange(e.onAIChanged),c.add(e.ai,`leaderSpeedMul`).name(`领头极速倍率`).listen().disable(),c.add(e.ai,`gapToPlayer`).name(`与玩家进度差`).listen().disable();let l=this.gui.addFolder(`道具`);l.add(e.item,`held`).name(`手里的道具`).listen().disable(),l.add(e.item,`effects`).name(`身上的效果`).listen().disable(),l.add(e.item,`entities`).name(`投射物/陷阱`).listen().disable(),l.add(e.item,`chances`).name(`当前名次概率`).listen().disable(),l.add(e.item,`forceItem`,[...So]).name(`调试发货`),l.add({grant:e.onGrantItem},`grant`).name(`发一个给我`),this.section(`道具箱`,e.itemBox,mo,l),this.section(`投射物`,e.projectile,Oo,l);let u=this.gui.addFolder(`性能`);u.add(e.perf,`tier`).name(`画质档位`).listen().disable(),u.add(e.perf,`fps`).name(`平均帧率`).listen().disable(),u.add(e.perf,`drawCalls`).name(`drawcall`).listen().disable(),u.add(e.perf,`triangles`).name(`三角面`).listen().disable(),u.add(e.perf,`pixelRatio`).name(`像素比`).listen().disable(),u.add(e.perf,`particles`).name(`粒子 火花/尘/爆闪`).listen().disable(),u.add(e.perf,`audioFallback`).name(`占位音效`).disable(),u.add(e.perf,`budget`).name(`low 档预算`).disable(),u.add(e.perf,`autoAdapt`).name(`帧率自适应降档`),this.gui.add({reset:e.onResetKart},`reset`).name(`重开比赛 (R)`),this.gui.add({resetAll:()=>this.resetAll()},`resetAll`).name(`全部参数恢复默认`),document.body.classList.add(`debug-gui-open`),window.addEventListener(`keydown`,this.onKeyDown)}addScalar(e,t,n){let[r,i,a]=an[n];e.add(t,n,r,i,a)}addTriple(e,t,n){let{range:r,label:i}=on[n],[a,o,s]=r,c=e.addFolder(`${n} · ${i}`);for(let e=0;e<3;e++)c.add(t[n],e,a,o,s).name(sn[e])}section(e,t,n,r=this.gui){let i=r.addFolder(e);for(let e of Object.keys(n)){let[r,a,o]=n[e];i.add(t,e,r,a,o)}}resetAll(){for(let e of Object.keys(an))this.targets.kart[e]=rn[e];for(let e of Object.keys(on)){let t=this.targets.kart[e],n=rn[e];for(let e=0;e<3;e++)t[e]=n[e]}Object.assign(this.targets.camera,Er),Object.assign(this.targets.view,Hr),Object.assign(this.targets.collision,wn),this.gui.controllersRecursive().forEach(e=>e.updateDisplay())}setVisible(e){this.visible=e,this.gui.show(e),document.body.classList.toggle(`debug-gui-open`,e)}onKeyDown=e=>{e.code===`KeyH`&&this.setVisible(!this.visible)};dispose(){window.removeEventListener(`keydown`,this.onKeyDown),document.body.classList.remove(`debug-gui-open`),this.gui.destroy()}},Ho=class{track;boxes;projectiles=[];traps=[];projectileConfig;slots=new Map;events=[];rng;seed;nextEntityId=1;pickups=[];targets=[];constructor(e,t,n={}){this.track=e,this.boxes=t,this.seed=n.seed??24301,this.rng=Zn(this.seed),this.projectileConfig={...Do,...n.projectile}}register(e){this.slots.has(e)||this.slots.set(e,{held:null,effects:new bo})}reset(){for(let e of this.slots.values())e.held=null,e.effects.clear();this.projectiles.length=0,this.traps.length=0,this.events.length=0,this.boxes.reset()}held(e){return this.slots.get(e)?.held??null}grant(e,t){this.register(e),this.slots.get(e).held=t}effectsOf(e){let t=this.slots.get(e);return t||(t={held:null,effects:new bo},this.slots.set(e,t)),t.effects}consumeEvents(){return this.events.length===0?[]:this.events.splice(0,this.events.length)}update(e,t){if(!(t<=0)){this.syncTargets(e);for(let n of e)this.effectsOf(n.id).update(t);this.stepProjectiles(t),this.stepTraps(t),this.collectBoxes(e,t),this.consumeUseRequests(e)}}syncTargets(e){this.targets.length=0;for(let t of e)this.targets.push({id:t.id,x:t.state.x,y:t.state.y,z:t.state.z,trackT:t.trackT})}stepProjectiles(e){for(let t=this.projectiles.length-1;t>=0;t--){let n=this.projectiles[t],r=Po(n,this.track.progressAt(n.x,n.z),this.track,this.targets,this.projectileConfig,e);r.kind!==`alive`&&(r.kind===`hit`&&this.applyHarm(r.targetId,n.ownerId,n.onHit),this.projectiles.splice(t,1))}}stepTraps(e){for(let t=this.traps.length-1;t>=0;t--){let n=this.traps[t],r=Fo(n,this.targets,e);r.hitId&&this.applyHarm(r.hitId,n.ownerId,n.onHit),r.done&&this.traps.splice(t,1)}}collectBoxes(e,t){this.boxes.update(t,this.targets,this.pickups);for(let t of this.pickups){let n=this.slots.get(t.pickerId);if(!n||n.held!==null)continue;let r=e.find(e=>e.id===t.pickerId);r&&(n.held=Eo(r.place,e.length,this.rng),this.events.push({type:`pickup`,kartId:r.id,item:n.held}))}}consumeUseRequests(e){for(let t of e){if(!t.useItem)continue;let n=this.slots.get(t.id);if(!n?.held)continue;let r=n.held;n.held=null,this.fire(xo[r],t,e),this.events.push({type:`use`,kartId:t.id,item:r})}}fire(e,t,n){let r={userId:t.id,x:t.state.x,y:t.state.y,z:t.state.z,heading:t.state.heading,trackT:t.trackT,place:t.place,racerCount:n.length},i=e.apply(r,this.rng);if(i.grantBoost){let{level:e,duration:n}=i.grantBoost;n>=t.state.boostTime&&(t.state.boostTime=n,t.state.boostLevel=e)}if(i.selfEffects){let e=this.effectsOf(t.id);for(let t of i.selfEffects)e.add(t)}if(i.spawnTrap){let e=i.spawnTrap;this.traps.push({id:this.nextEntityId++,ownerId:t.id,x:r.x-Math.sin(r.heading)*e.dropBack,y:r.y,z:r.z-Math.cos(r.heading)*e.dropBack,radius:e.radius,life:e.life,armDelay:e.armDelay,ownerGrace:e.ownerGrace,onHit:e.onHit})}if(i.spawnProjectile){let n=i.spawnProjectile,a=e.targetType===`backward`,o=n.homing?a?Mo(r.trackT,t.id,this.targets):jo(r.trackT,t.id,this.targets):null;this.projectiles.push({id:this.nextEntityId++,ownerId:t.id,x:r.x,y:r.y+this.projectileConfig.hoverHeight,z:r.z,heading:a?r.heading+Math.PI:r.heading,speed:n.speed,life:n.life,radius:n.radius,homing:n.homing,targetId:o,onHit:i.targetEffects??n.onHit})}if(i.targetEffects&&!i.spawnProjectile)for(let a of this.selectTargets(e.targetType,r,n))this.applyHarm(a,t.id,i.targetEffects)}selectTargets(e,t,n){switch(e){case`self`:return[t.userId];case`allOthers`:return n.filter(e=>e.id!==t.userId).map(e=>e.id);case`forward`:{let e=jo(t.trackT,t.userId,this.targets);return e?[e]:[]}case`backward`:{let e=Mo(t.trackT,t.userId,this.targets);return e?[e]:[]}}}applyHarm(e,t,n){if(n.length===0)return;let r=this.effectsOf(e);if(r.consumeShield()){this.events.push({type:`blocked`,kartId:e});return}for(let e of n)r.add(e);this.events.push({type:`hit`,kartId:e,by:t})}},Uo=1.6,Wo=1.1,Go=class{group=new c;mesh;matrix=new u;position=new o;quaternion=new ne;scale=new o(1,1,1);spin=0;constructor(e){let t=new g(Uo,Uo,Uo),n=new S({color:`#ffd34d`,emissive:`#4a3a00`,roughness:.3,metalness:.1,transparent:!0,opacity:.82});this.mesh=new s(t,n,Math.max(e.length,1)),this.mesh.castShadow=!0,this.mesh.frustumCulled=!1,this.group.add(this.mesh),this.update(e,0)}update(e,t){this.spin+=t*1.6;let n=Math.min(e.length,this.mesh.instanceMatrix.count);for(let t=0;t<n;t++){let n=e[t];this.scale.setScalar(+!!n.active),this.position.set(n.x,n.y+Wo+Math.sin(this.spin*1.7+t)*.12,n.z),this.quaternion.setFromAxisAngle(Ko,this.spin),this.mesh.setMatrixAt(t,this.matrix.compose(this.position,this.quaternion,this.scale))}this.mesh.count=n,this.mesh.instanceMatrix.needsUpdate=!0}},Ko=new o(0,1,0),qo=class{group;make;free=[];used=new Map;seen=new Set;constructor(e,t){this.group=e,this.make=t}beginFrame(){this.seen.clear()}claim(e){this.seen.add(e);let t=this.used.get(e);return t||(t=this.free.pop()??this.make(),t.visible=!0,this.group.add(t),this.used.set(e,t)),t}endFrame(){for(let[e,t]of this.used)this.seen.has(e)||(t.visible=!1,this.used.delete(e),this.free.push(t))}},Jo=class{group=new c;pool;spin=0;constructor(){let e=new p(.9,16,12),n=new S({color:`#3fc4ff`,emissive:`#0a4b6b`,roughness:.25,metalness:.4});this.pool=new qo(this.group,()=>{let r=new t(e,n);r.castShadow=!0;let i=new t(new te(.55,2.4,12),new y({color:`#9fe6ff`,transparent:!0,opacity:.35}));return i.rotation.x=Math.PI/2,i.position.z=-1.4,r.add(i),r})}update(e,t){this.spin+=t*9,this.pool.beginFrame();for(let t of e){let e=this.pool.claim(t.id);e.position.set(t.x,t.y,t.z),e.rotation.y=t.heading,e.rotation.z=this.spin}this.pool.endFrame()}},Yo=class{group=new c;pool;pulse=0;constructor(){let e=new te(1.1,.9,4),n=new S({color:`#ff5fa2`,emissive:`#5a0028`,roughness:.5});this.pool=new qo(this.group,()=>{let r=new t(e,n);return r.castShadow=!0,r.rotation.y=Math.PI/4,r})}update(e,t){this.pulse+=t*4,this.pool.beginFrame();for(let t of e){let e=this.pool.claim(t.id);e.position.set(t.x,t.y+.45,t.z);let n=t.armDelay<=0?1+Math.sin(this.pulse)*.08:.6;e.scale.setScalar(n)}this.pool.endFrame()}},k=Object.freeze({accent:`#2fa8ff`,gold:`#ffd23f`,mint:`#5ef0b4`,danger:`#ff5f6d`,panel:`rgba(13, 17, 27, 0.78)`,ink:`#0d111b`}),Xo=!1;function Zo(){if(Xo)return;Xo=!0;let e=document.createElement(`style`);e.textContent=Qo,document.head.appendChild(e)}var Qo=`
  :root {
    --k-accent: ${k.accent};
    --k-accent-deep: #1b7fd4;
    --k-gold: ${k.gold};
    --k-mint: ${k.mint};
    --k-danger: ${k.danger};
    --k-ink: ${k.ink};
    --k-panel: ${k.panel};
    --k-panel-line: rgba(255, 255, 255, 0.16);
    --k-text: #ffffff;
    --k-text-dim: rgba(255, 255, 255, 0.62);

    --k-r-sm: 8px;
    --k-r-md: 14px;
    --k-r-lg: 22px;
    --k-r-pill: 999px;

    --k-shadow-panel: 0 18px 48px rgba(0, 0, 0, 0.45);
    --k-shadow-chip: 0 4px 14px rgba(0, 0, 0, 0.35);

    /* 圆头字体栈。ui-rounded 在苹果上就是 SF Pro Rounded；
       中文按 苹方 -> 微软雅黑 往下退，两者都够圆 */
    --k-font: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI",
      "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    /* 数字用等宽：计时器每一帧都在变，不等宽的话整行会左右抽搐 */
    --k-font-num: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;
  }

  /* --- 描边字 -------------------------------------------------------------
     八个方向的 text-shadow 拼出一圈描边，最后再加一层柔和投影托住它。
     用 -webkit-text-stroke 的话描边是**压在字身上**的（往里吃掉一半笔画），
     小字号下会糊成一团，所以这里宁可多写八个阴影。 */
  .k-outline {
    text-shadow:
      2px 0 0 var(--k-ink), -2px 0 0 var(--k-ink),
      0 2px 0 var(--k-ink), 0 -2px 0 var(--k-ink),
      1.4px 1.4px 0 var(--k-ink), -1.4px 1.4px 0 var(--k-ink),
      1.4px -1.4px 0 var(--k-ink), -1.4px -1.4px 0 var(--k-ink),
      0 6px 14px rgba(0, 0, 0, 0.45);
  }
  /* 大号字（倒计时、名次）用更粗的描边，不然比例看着虚 */
  .k-outline-lg {
    text-shadow:
      4px 0 0 var(--k-ink), -4px 0 0 var(--k-ink),
      0 4px 0 var(--k-ink), 0 -4px 0 var(--k-ink),
      2.8px 2.8px 0 var(--k-ink), -2.8px 2.8px 0 var(--k-ink),
      2.8px -2.8px 0 var(--k-ink), -2.8px -2.8px 0 var(--k-ink),
      0 10px 26px rgba(0, 0, 0, 0.5);
  }

  /* --- 面板 --------------------------------------------------------------- */
  .k-panel {
    background: var(--k-panel);
    border: 1px solid var(--k-panel-line);
    border-radius: var(--k-r-lg);
    box-shadow: var(--k-shadow-panel);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  /* HUD 上的小块（计时、状态），比面板轻一档 */
  .k-chip {
    background: rgba(13, 17, 27, 0.42);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--k-r-md);
    box-shadow: var(--k-shadow-chip);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  /* --- 按钮 ---------------------------------------------------------------
     HUD 整层是 pointer-events: none，按钮要自己把事件收回来 */
  .k-btn {
    pointer-events: auto;
    font-family: var(--k-font);
    font-weight: 800;
    letter-spacing: 1px;
    color: var(--k-ink);
    background: linear-gradient(180deg, var(--k-accent), var(--k-accent-deep));
    border: none;
    border-radius: var(--k-r-pill);
    /* 下边一道深色 = 立体的"厚度"，按下去时收掉，就有了物理按键的手感 */
    box-shadow: 0 4px 0 rgba(0, 0, 0, 0.35), 0 10px 22px rgba(0, 0, 0, 0.35);
    padding: 12px 30px;
    font-size: 16px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform 90ms ease, box-shadow 90ms ease, filter 120ms ease;
  }
  .k-btn:hover { filter: brightness(1.08); }
  .k-btn:active {
    transform: translateY(3px);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.35), 0 4px 10px rgba(0, 0, 0, 0.35);
  }
  .k-btn-ghost {
    background: rgba(255, 255, 255, 0.1);
    color: var(--k-text);
    box-shadow: 0 3px 0 rgba(0, 0, 0, 0.28);
    border: 1px solid var(--k-panel-line);
  }

  /* 分段选择器：设置面板和赛道选择共用 */
  .k-seg { display: flex; gap: 5px; }
  .k-seg button {
    pointer-events: auto;
    flex: 1;
    padding: 8px 0;
    font-size: 12px;
    font-family: var(--k-font);
    font-weight: 700;
    border-radius: var(--k-r-sm);
    border: 1px solid var(--k-panel-line);
    background: rgba(255, 255, 255, 0.06);
    color: var(--k-text);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 120ms ease, color 120ms ease;
  }
  .k-seg button.is-on {
    background: var(--k-accent);
    border-color: var(--k-accent);
    color: var(--k-ink);
  }

  /* 滑条：音量用。原生外观在各平台差别太大，统一重画 */
  .k-range {
    pointer-events: auto;
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.2);
    outline: none;
  }
  .k-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px; height: 16px;
    border-radius: 50%;
    background: var(--k-accent);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }
  .k-range::-moz-range-thumb {
    width: 16px; height: 16px; border: none;
    border-radius: 50%;
    background: var(--k-accent);
    cursor: pointer;
  }

  /* --- 排版 --------------------------------------------------------------- */
  .k-num { font-family: var(--k-font-num); font-variant-numeric: tabular-nums; }
  .k-label {
    font-size: 11px;
    letter-spacing: 3px;
    color: var(--k-text-dim);
    text-transform: uppercase;
  }
`,$o=class{root;speed;speedValue;fpsValue;driftValue;speedLines;frames=0;elapsed=0;fps=0;boosting=!1;constructor(e){Zo(),ts(),this.root=document.createElement(`div`),this.root.className=`hud`,this.root.innerHTML=`
      <div class="hud-speedlines"></div>
      <div class="hud-speed k-outline-lg">
        <span class="hud-speed-value k-num">0</span><span class="hud-speed-unit">km/h</span>
      </div>
      <div class="hud-stats k-chip">FPS <span class="hud-fps k-num">0</span> · <span class="hud-drift">—</span></div>
      <div class="hud-help">W/↑ 油门 · S/↓ 刹车倒车 · A D/← → 转向 · Space 刹车 · Shift 漂移 · Q/右键 道具 · R 重开 · H 收调参面板</div>
    `,e.appendChild(this.root),this.speed=this.root.querySelector(`.hud-speed`),this.speedValue=this.root.querySelector(`.hud-speed-value`),this.fpsValue=this.root.querySelector(`.hud-fps`),this.driftValue=this.root.querySelector(`.hud-drift`),this.speedLines=this.root.querySelector(`.hud-speedlines`)}update(e,t,n=0,r=`—`){this.speedValue.textContent=String(Math.round(Math.abs(e)*3.6)),this.speedLines.style.opacity=n.toFixed(3);let i=n>.05;i!==this.boosting&&(this.boosting=i,this.speed.classList.toggle(`is-boosting`,i)),this.driftValue.textContent!==r&&(this.driftValue.textContent=r),this.frames++,this.elapsed+=t,this.elapsed>=.25&&(this.fps=this.frames/this.elapsed,this.frames=0,this.elapsed=0,this.fpsValue.textContent=this.fps.toFixed(0))}},es=!1;function ts(){if(es)return;es=!0;let e=document.createElement(`style`);e.textContent=`
    .hud {
      position: absolute; inset: 0; pointer-events: none;
      color: var(--k-text); font-family: var(--k-font);
    }
    .hud-speed {
      position: absolute; left: 26px; bottom: 24px;
      display: flex; align-items: baseline; gap: 6px;
      transition: color 140ms ease;
    }
    .hud-speed.is-boosting { color: var(--k-gold); }
    .hud-speed-value { font-size: 74px; font-weight: 900; letter-spacing: -3px; line-height: 0.9; }
    .hud-speed-unit { font-size: 15px; font-weight: 700; opacity: 0.85; letter-spacing: 1px; }
    .hud-stats {
      position: absolute; left: 26px; top: 20px;
      font-size: 12px; font-weight: 600; color: var(--k-text-dim);
      padding: 6px 11px;
    }
    .hud-help {
      position: absolute; left: 0; right: 0; bottom: 8px;
      text-align: center; font-size: 12px; color: rgba(255,255,255,0.55);
      text-shadow: 0 2px 6px rgba(0,0,0,0.6);
    }
    /* boost 速度线：屏幕边缘往内收的放射状条纹，中间留空不挡视线 */
    .hud-speedlines {
      position: absolute; inset: 0; opacity: 0;
      transition: opacity 90ms linear;
      background:
        repeating-conic-gradient(from 0deg at 50% 50%,
          rgba(255,255,255,0.5) 0deg 0.7deg, transparent 0.7deg 4deg);
      -webkit-mask-image: radial-gradient(ellipse 42% 42% at 50% 50%, transparent 55%, #000 100%);
      mask-image: radial-gradient(ellipse 42% 42% at 50% 50%, transparent 55%, #000 100%);
      mix-blend-mode: screen;
    }
    @media (max-width: 640px) {
      .hud-speed-value { font-size: 46px; letter-spacing: -2px; }
      .hud-help { display: none; }
    }
    /* 触屏时按键提示是错的（按钮就在屏幕上），直接不显示 */
    body.touch-input .hud-help { display: none; }
    /* 触屏时速度表留在左下角，但要缩小并让开刘海/小白条。
       摇杆区盖在它上面没关系：HUD 整层是 pointer-events: none，挡不住手指 */
    body.touch-input .hud-speed {
      left: calc(20px + env(safe-area-inset-left));
      bottom: calc(12px + env(safe-area-inset-bottom));
    }
    body.touch-input .hud-speed-value { font-size: 42px; }
  `,document.head.appendChild(e)}var ns={boost:{label:`加速`,color:`#ffb020`},slow:{label:`减速`,color:`#8fa3b8`},spinout:{label:`失控`,color:`#ff5f5f`},shield:{label:`护盾`,color:`#7cf7c4`}},rs={common:`rgba(255,255,255,0.35)`,uncommon:k.accent,rare:k.gold},is=.55,as=class{root;slot;icon;label;effectRow;effectEls=new Map;rollTime=0;rollPhase=0;lastSignature=``;constructor(e){Zo(),ls(),this.root=document.createElement(`div`),this.root.className=`item-hud`,this.root.innerHTML=`
      <div class="item-slot k-chip item-slot-empty">
        <span class="item-icon"></span>
        <span class="item-label">无道具</span>
      </div>
      <div class="item-effects"></div>
      <div class="item-hint">Q / 右键 使用</div>
    `,e.appendChild(this.root);let t=e=>this.root.querySelector(e);this.slot=t(`.item-slot`),this.icon=t(`.item-icon`),this.label=t(`.item-label`),this.effectRow=t(`.item-effects`)}setVisible(e){this.root.style.display=e?``:`none`}playRoll(){this.rollTime=is}update(e,t){this.renderSlot(e,t),this.renderEffects(e.effects)}renderSlot(e,t){let n=e.held,r=n?`${n.id}|${n.rarity}`:``;if(r!==this.lastSignature&&(this.lastSignature=r,this.slot.classList.toggle(`item-slot-empty`,n===null),os(this.icon,n?.icon??``),os(this.label,n?.name??`无道具`),this.slot.style.background=n?ss(n.color,.85):`rgba(0,0,0,0.3)`,this.slot.style.borderColor=n?rs[n.rarity]:`rgba(255,255,255,0.18)`),this.rollTime>0){this.rollTime=Math.max(0,this.rollTime-t),this.rollPhase+=t*26;let e=this.rollTime/is,n=1+.22*e,r=Math.sin(this.rollPhase)*5*e;this.slot.style.transform=`scale(${n.toFixed(3)}) rotate(${r.toFixed(2)}deg)`}else this.slot.style.transform!==``&&(this.slot.style.transform=``)}renderEffects(e){let t=new Set;for(let n of e){t.add(n.type);let e=this.effectEls.get(n.type);if(!e){let t=document.createElement(`div`);t.className=`item-eff`;let r=ns[n.type];t.innerHTML=`<span>${r.label}</span><i class="item-eff-bar"></i>`,t.style.color=r.color,t.querySelector(`.item-eff-bar`).style.background=r.color,this.effectRow.appendChild(t),e={box:t,bar:t.querySelector(`.item-eff-bar`)},this.effectEls.set(n.type,e)}let r=n.total>0?Math.max(0,Math.min(n.remaining/n.total,1)):0;e.bar.style.width=`${(r*100).toFixed(1)}%`}for(let[e,n]of this.effectEls)t.has(e)||(n.box.remove(),this.effectEls.delete(e))}};function os(e,t){e.textContent!==t&&(e.textContent=t)}function ss(e,t){let n=/^#?([0-9a-f]{6})$/i.exec(e.trim());if(!n)return e;let r=parseInt(n[1],16);return`rgba(${r>>16&255}, ${r>>8&255}, ${r&255}, ${t})`}var cs=!1;function ls(){if(cs)return;cs=!0;let e=document.createElement(`style`);e.textContent=`
    /* 左下角。.hud-speed（速度数字）占了 left:26 bottom:24，所以往上让开一截 */
    .item-hud {
      position: absolute; left: 26px; bottom: 118px;
      pointer-events: none; color: var(--k-text);
      font-family: var(--k-font);
      display: flex; flex-direction: column; align-items: flex-start; gap: 7px;
    }
    .item-slot {
      width: 86px; height: 86px; border-radius: var(--k-r-md);
      border-width: 2px; border-style: solid;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 3px; transform-origin: center;
      transition: background 140ms ease, border-color 140ms ease;
    }
    .item-icon { font-size: 32px; line-height: 1; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.5)); }
    .item-label { font-size: 12px; font-weight: 700; letter-spacing: 1px; text-shadow: 0 2px 6px rgba(0,0,0,0.6); }
    .item-slot-empty { opacity: 0.45; }
    .item-slot-empty .item-label { font-size: 11px; }

    .item-effects { display: flex; flex-direction: column; gap: 4px; min-height: 0; }
    .item-eff {
      font-size: 11px; font-weight: 700; letter-spacing: 1px;
      background: rgba(13,17,27,0.55); border-radius: var(--k-r-sm);
      padding: 3px 8px 5px; min-width: 68px;
      display: flex; flex-direction: column; gap: 3px;
    }
    /* 进度条从满走到空，用 transition 会让它一顿一顿的（每帧都在改宽度），
       所以不给它任何过渡 —— 每帧写一次就是最平滑的 */
    .item-eff-bar { height: 3px; border-radius: 2px; width: 100%; display: block; }

    .item-hint { font-size: 11px; color: var(--k-text-dim); letter-spacing: 1px; }
    /* 触屏上道具键在右上角，"Q / 右键"这行提示是错的 */
    body.touch-input .item-hint { display: none; }

    @media (max-width: 640px) {
      .item-hud { bottom: 88px; }
      .item-slot { width: 64px; height: 64px; }
      .item-icon { font-size: 26px; }
      .item-hint { display: none; }
    }
  `,document.head.appendChild(e)}var us=1.6,ds=2.6,fs=1,ps=class{actions;root;lapValue;lapTotal;posBox;posValue;curValue;lastValue;bestValue;recordRow;recordValue;center;warn;results;trackBar;cupBadge;ghostGap;dotEls=new Map;popupTime=0;popupTotal=us;resultsSignature=``;constructor(e,t={}){this.actions=t,Zo(),bs(),this.root=document.createElement(`div`),this.root.className=`race-hud`,this.root.innerHTML=`
      <div class="race-lap k-outline">
        <span class="race-lap-label">LAP</span><!--
     --><span class="race-lap-value k-num">1</span><!--
     --><span class="race-lap-total k-num">/3</span>
      </div>
      <div class="race-pos k-outline-lg" hidden>
        <span class="race-pos-value k-num">1</span><span class="race-pos-label">位</span>
      </div>
      <div class="race-times k-chip">
        <div class="race-row race-row-cur"><span class="race-k">本圈</span><span class="race-v k-num">0.000</span></div>
        <div class="race-row race-row-last"><span class="race-k">上圈</span><span class="race-v k-num">--.---</span></div>
        <div class="race-row race-row-best"><span class="race-k">最佳</span><span class="race-v k-num">--.---</span></div>
        <div class="race-row race-row-record"><span class="race-k">纪录</span><span class="race-v k-num">--.---</span></div>
      </div>
      <div class="race-cup k-chip" hidden></div>
      <div class="race-ghost k-outline" hidden></div>
      <div class="race-track" hidden><div class="race-track-line"></div></div>
      <div class="race-center k-outline-lg" hidden></div>
      <div class="race-warn" hidden>⚠ 漏了 checkpoint · 本圈不计</div>
      <div class="race-results k-panel" hidden></div>
    `,e.appendChild(this.root);let n=e=>this.root.querySelector(e);this.lapValue=n(`.race-lap-value`),this.lapTotal=n(`.race-lap-total`),this.posBox=n(`.race-pos`),this.posValue=n(`.race-pos-value`),this.curValue=n(`.race-row-cur .race-v`),this.lastValue=n(`.race-row-last .race-v`),this.bestValue=n(`.race-row-best .race-v`),this.recordRow=n(`.race-row-record`),this.recordValue=n(`.race-row-record .race-v`),this.trackBar=n(`.race-track`),this.cupBadge=n(`.race-cup`),this.ghostGap=n(`.race-ghost`),this.center=n(`.race-center`),this.warn=n(`.race-warn`),this.results=n(`.race-results`)}showGo(){this.popup(`GO!`,`race-center-go`,fs)}showLapSplit(e,t,n,r){let i=r?`★ 新纪录 ★`:n?`最佳圈`:`第 ${e} 圈`,a=r?`race-center-record`:n?`race-center-best`:`race-center-lap`;this.popup(`<span class="race-pop-tag">${i}</span><span class="race-pop-time">${Ja(t)}</span>`,a,r?ds:us)}update(e,t){let n=Math.min(Math.max(e.lap,1),e.totalLaps);A(this.lapValue,String(n)),A(this.lapTotal,`/${e.totalLaps}`);let r=e.racerCount>1;this.posBox.hidden=!r,r&&A(this.posValue,String(e.place)),A(this.curValue,Ja(e.lapTime)),A(this.lastValue,Ya(e.lastLap)),A(this.bestValue,Ya(e.bestLap)),this.recordRow.hidden=e.recordLap===null,e.recordLap!==null&&A(this.recordValue,Ja(e.recordLap));let i=e.bestLap!==null&&(e.recordLap===null||e.bestLap<=e.recordLap);if(this.bestValue.classList.toggle(`race-v-record`,i),this.cupBadge.hidden=e.cup===null,e.cup){let t=e.cup.standings.find(e=>e.isPlayer);A(this.cupBadge,`${e.cup.name} 第 ${e.cup.round}/${e.cup.total} 场`+(t?` · 总分 ${t.points}（第 ${t.place}）`:``))}this.renderGhostGap(e.ghostGap),this.renderDots(e.dots),this.warn.hidden=e.lapValid||e.phase!==`racing`,e.phase===`countdown`?this.renderCountdown(e.countdown):e.results?(this.popupTime=0,this.center.hidden=!0):this.tickPopup(t),this.renderResults(e)}renderDots(e){if(this.trackBar.hidden=e.length<2,this.trackBar.hidden)return;let t=new Set;for(let n of e){t.add(n.id);let e=this.dotEls.get(n.id);e||(e=document.createElement(`i`),e.className=n.isPlayer?`race-dot race-dot-me`:`race-dot`,this.trackBar.appendChild(e),this.dotEls.set(n.id,e));let r=(n.t%1+1)%1;e.style.left=`calc(10px + ${(r*100).toFixed(2)}% - ${(r*20).toFixed(2)}px)`,e.style.background!==n.color&&(e.style.background=n.color)}for(let[e,n]of this.dotEls)t.has(e)||(n.remove(),this.dotEls.delete(e))}renderGhostGap(e){if(this.ghostGap.hidden=e===null,e===null)return;let t=e>0,n=Math.abs(e)<1?`与幽灵并排`:`${t?`领先`:`落后`} ${Math.abs(e).toFixed(0)} m`;A(this.ghostGap,n),this.ghostGap.classList.toggle(`is-ahead`,Math.abs(e)>=1&&t),this.ghostGap.classList.toggle(`is-behind`,Math.abs(e)>=1&&!t)}renderCountdown(e){let t=Math.ceil(e),n=e-Math.floor(e);this.center.hidden=!1,this.center.className=`race-center race-center-count`,vs(this.center,String(Math.max(t,1))),this.center.style.transform=`translate(-50%, -50%) scale(${(1+n*.5).toFixed(3)})`,this.center.style.opacity=(1.2-n*.5).toFixed(3),this.popupTime=0}popup(e,t,n){this.center.hidden=!1,this.center.className=`race-center ${t}`,vs(this.center,e),this.popupTime=n,this.popupTotal=n}tickPopup(e){if(this.popupTime<=0){this.center.hidden||(this.center.hidden=!0);return}this.popupTime=Math.max(0,this.popupTime-e);let t=1-this.popupTime/this.popupTotal,n=t<.12?t/.12:1,r=this.popupTime/this.popupTotal<.3?this.popupTime/this.popupTotal/.3:1,i=.7+.3*n+.12*(1-n);this.center.style.transform=`translate(-50%, -50%) scale(${i.toFixed(3)})`,this.center.style.opacity=r.toFixed(3),this.popupTime===0&&(this.center.hidden=!0)}renderResults(e){let t=e.results;if(!t){this.results.hidden||(this.results.hidden=!0,this.resultsSignature=``);return}let n=t.standings.map(e=>`${e.place}${e.name}${e.finishTime??e.lap}`).join(`;`),r=e.cup?`${e.cup.round}/${e.cup.total}|${e.cup.standings.map(e=>`${e.place}:${e.points}`).join(`,`)}`:``,i=`${t.place}|${t.totalTime}|${t.lapTimes.join(`,`)}|${t.newRecord}|${n}|${r}`;if(i===this.resultsSignature)return;this.resultsSignature=i;let a=t.lapTimes.map((e,n)=>`<li class="${t.bestLap!==null&&e===t.bestLap?`race-res-lap race-res-lap-best`:`race-res-lap`}">
          <span>第 ${n+1} 圈</span><span>${Ja(e)}</span></li>`).join(``);this.results.innerHTML=`
      <div class="race-res-title k-label">完赛</div>
      ${e.racerCount>1?`<div class="race-res-place k-outline">第 ${t.place} 名</div>`:``}
      <div class="race-res-total k-num">${Ja(t.totalTime)}</div>
      <ol class="race-res-laps">${a}</ol>
      <div class="race-res-best">最佳圈 <span class="k-num">${Ya(t.bestLap)}</span></div>
      ${t.newRecord?`<div class="race-res-record">★ 打破本地纪录</div>`:``}
      ${hs(t.standings)}
      ${ms(e.cup)}
      <div class="race-res-actions">
        ${e.cup&&!e.cup.finished?`<button class="k-btn race-res-next" type="button">下一场</button><button class="k-btn k-btn-ghost race-res-again" type="button">重跑本场</button>`:`<button class="k-btn race-res-again" type="button">再来一局</button>`}
        <button class="k-btn k-btn-ghost race-res-change" type="button">${e.cup?`回主菜单`:`换赛道`}</button>
      </div>
      <div class="race-res-hint">或按 R 重开</div>
    `,this.results.querySelector(`.race-res-again`).addEventListener(`click`,()=>this.actions.onRestart?.()),this.results.querySelector(`.race-res-next`)?.addEventListener(`click`,()=>this.actions.onNextRound?.()),this.results.querySelector(`.race-res-change`).addEventListener(`click`,()=>this.actions.onChangeTrack?.()),this.results.hidden=!1}};function ms(e){return e?`<div class="race-rank-title">${e.finished?`杯赛最终成绩`:`杯赛积分 · 第 ${e.round}/${e.total} 场后`}</div><ol class="race-rank">${e.standings.map(e=>{let t=e.rounds.map(e=>`<i class="race-cup-round">${e===null?`–`:e}</i>`).join(``);return`<li class="race-rank-row${e.isPlayer?` race-rank-me`:``}">
        <span class="race-rank-place">${e.place}</span>
        <i class="race-rank-chip" style="background:${_s(e.color)}"></i>
        <span class="race-rank-name">${gs(e.name)}</span>
        <span class="race-cup-rounds">${t}</span>
        <span class="race-cup-points">${e.points}</span>
      </li>`}).join(``)}</ol>${e.finished&&e.standings[0]?`<div class="race-res-record">🏆 ${gs(e.standings[0].name)} 夺得${gs(e.name)}</div>`:``}`:``}function hs(e){return e.length<2?``:`<div class="race-rank-title">排名</div><ol class="race-rank">${e.map(e=>{let t=e.finished?Ja(e.finishTime??0):`第 ${e.lap+1} 圈`;return`<li class="race-rank-row${e.isPlayer?` race-rank-me`:``}">
        <span class="race-rank-place">${e.place}</span>
        <i class="race-rank-chip" style="background:${_s(e.color)}"></i>
        <span class="race-rank-name">${gs(e.name)}</span>
        <span class="race-rank-time${e.finished?``:` race-rank-dnf`}">${t}</span>
      </li>`}).join(``)}</ol>`}function gs(e){return e.replace(/[&<>]/g,e=>e===`&`?`&amp;`:e===`<`?`&lt;`:`&gt;`)}function _s(e){return e.replace(/["'<>&]/g,``)}function A(e,t){e.textContent!==t&&(e.textContent=t)}function vs(e,t){e.innerHTML!==t&&(e.innerHTML=t)}var ys=!1;function bs(){if(ys)return;ys=!0;let e=document.createElement(`style`);e.textContent=`
    .race-hud {
      position: absolute; inset: 0; pointer-events: none;
      color: var(--k-text); font-family: var(--k-font);
    }
    /* 下面好几个块都是 display:flex，会盖掉 UA 的 [hidden]{display:none}，
       于是 el.hidden = true 根本藏不住（实测：空的结算面板会一直挂在屏幕中间）。
       这一条把 hidden 抢回来。 */
    .race-hud [hidden] { display: none !important; }

    /* 左上：圈数。Hud.ts 的 .hud-stats 占了 top:20，这里往下让一行 */
    .race-lap {
      position: absolute; left: 26px; top: 56px;
      display: flex; align-items: baseline; gap: 4px;
    }
    .race-lap-label {
      font-size: 12px; font-weight: 800; letter-spacing: 3px;
      opacity: 0.75; margin-right: 5px;
    }
    .race-lap-value { font-size: 44px; font-weight: 900; line-height: 0.95; }
    .race-lap-total { font-size: 20px; font-weight: 700; opacity: 0.7; }
    /* 名次：整块 HUD 里最大的一个数字。它是"我现在打得怎么样"的唯一答案，
       扫一眼就该看到，所以字号压过速度表 */
    .race-pos {
      position: absolute; left: 26px; top: 106px;
      display: flex; align-items: baseline; gap: 4px;
    }
    .race-pos-value {
      font-size: 56px; font-weight: 900; line-height: 0.9;
      color: var(--k-gold);
    }
    .race-pos-label { font-size: 15px; font-weight: 700; opacity: 0.8; }

    /* 右上：四行计时。lil-gui 也钉在右上角（宽 245px），开着的时候往左让开 */
    .race-times {
      position: absolute; right: 26px; top: 20px;
      transition: right 120ms ease;
      display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
      padding: 10px 14px;
    }
    .race-row { display: flex; align-items: baseline; gap: 12px; }
    .race-k { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: var(--k-text-dim); }
    .race-v { font-size: 17px; min-width: 8ch; text-align: right; }
    .race-row-cur .race-v { font-size: 27px; font-weight: 800; }
    .race-row-best .race-v { color: var(--k-gold); }
    .race-row-best .race-v.race-v-record { color: var(--k-mint); }
    .race-row-record .race-v { opacity: 0.75; font-size: 14px; }
    body.debug-gui-open .race-times { right: 268px; }
    /* 触屏时右上角被道具键占着，计时面板往左让，同时避开刘海 */
    body.touch-input .race-times {
      top: calc(14px + env(safe-area-inset-top));
      right: calc(30px + clamp(58px, 12vmin, 92px) + env(safe-area-inset-right));
    }

    /* 杯赛角标：顶部正中，比赛过程中一直挂着 */
    .race-cup {
      position: absolute; left: 50%; top: 18px; transform: translateX(-50%);
      padding: 6px 14px; font-size: 12px; font-weight: 700; letter-spacing: 1px;
      white-space: nowrap;
    }
    body.touch-input .race-cup { top: calc(14px + env(safe-area-inset-top)); }

    /* 幽灵车差距：挂在杯赛角标下面一点，计时赛里才有 */
    .race-ghost {
      position: absolute; left: 50%; top: 56px; transform: translateX(-50%);
      font-size: 17px; font-weight: 800; letter-spacing: 1px; white-space: nowrap;
    }
    .race-ghost.is-ahead { color: var(--k-mint); }
    .race-ghost.is-behind { color: var(--k-danger); }

    /* 中央：倒计时 / 圈速弹窗 */
    .race-center {
      position: absolute; left: 50%; top: 42%;
      transform: translate(-50%, -50%);
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      font-weight: 900; letter-spacing: -1px; white-space: nowrap;
    }
    .race-center-count { font-size: 140px; line-height: 1; }
    .race-center-go { font-size: 118px; line-height: 1; color: var(--k-mint); }
    .race-pop-tag { font-size: 19px; font-weight: 800; letter-spacing: 5px; opacity: 0.92; }
    .race-pop-time { font-size: 56px; font-family: var(--k-font-num); font-variant-numeric: tabular-nums; }
    .race-center-best .race-pop-time, .race-center-best .race-pop-tag { color: var(--k-gold); }
    .race-center-record .race-pop-time, .race-center-record .race-pop-tag { color: var(--k-mint); }
    .race-center-record .race-pop-tag { font-size: 24px; }

    .race-warn {
      position: absolute; left: 50%; top: 14%; transform: translateX(-50%);
      font-size: 13px; font-weight: 700; color: #fff;
      background: rgba(190, 30, 40, 0.75);
      border: 1px solid rgba(255,255,255,0.25);
      padding: 6px 14px; border-radius: var(--k-r-pill);
      box-shadow: var(--k-shadow-chip);
    }

    /* 结算面板 */
    .race-results {
      z-index: 40;
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      min-width: 320px; max-width: min(92vw, 420px); max-height: 88vh; overflow-y: auto;
      padding: 24px 30px 20px;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      /* 面板整体是 pointer-events: auto，否则滚动排名表时手指会穿到摇杆上 */
      pointer-events: auto;
    }
    .race-res-title { font-size: 12px; }
    .race-res-place { font-size: 26px; font-weight: 900; color: var(--k-gold); }
    .race-res-total { font-size: 48px; font-weight: 900; line-height: 1; }
    .race-res-laps { list-style: none; margin: 12px 0 4px; padding: 0; width: 100%; }
    .race-res-lap {
      display: flex; justify-content: space-between; gap: 24px;
      font-size: 15px; padding: 4px 0;
      font-family: var(--k-font-num); font-variant-numeric: tabular-nums;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .race-res-lap-best { color: var(--k-gold); font-weight: 700; }
    .race-res-best { font-size: 14px; color: var(--k-gold); }
    .race-res-record { font-size: 14px; color: var(--k-mint); font-weight: 800; letter-spacing: 1px; }
    .race-res-actions { display: flex; gap: 10px; margin-top: 16px; }
    .race-res-hint { font-size: 12px; color: var(--k-text-dim); margin-top: 8px; }

    /* 结算面板下半截：完整排名表 */
    .race-rank-title { font-size: 11px; letter-spacing: 4px; color: var(--k-text-dim); margin-top: 14px; }
    .race-rank {
      list-style: none; margin: 6px 0 0; padding: 0; width: 100%;
      max-height: 34vh; overflow-y: auto;
    }
    .race-rank-row {
      display: flex; align-items: center; gap: 9px;
      font-size: 14px; padding: 4px 0;
      font-variant-numeric: tabular-nums;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .race-rank-me { color: var(--k-gold); font-weight: 800; }
    .race-rank-place { width: 2ch; text-align: right; opacity: 0.75; font-family: var(--k-font-num); }
    .race-rank-chip {
      width: 11px; height: 11px; border-radius: 4px; flex: none;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.5);
    }
    .race-rank-name { flex: 1; min-width: 5ch; }
    /* 杯赛：每场名次排成一串，最后是总分 */
    .race-cup-rounds { display: flex; gap: 3px; flex: none; }
    .race-cup-round {
      width: 16px; height: 16px; line-height: 16px; text-align: center;
      border-radius: 4px; font-size: 10px; font-style: normal;
      background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.75);
      font-family: var(--k-font-num);
    }
    .race-cup-points {
      width: 3ch; text-align: right; font-weight: 800;
      font-family: var(--k-font-num); color: var(--k-gold);
    }
    .race-rank-time { opacity: 0.9; font-family: var(--k-font-num); }
    .race-rank-dnf { opacity: 0.5; }

    /* 底部中央：赛道进度条。一条横线，每辆车一个小圆点。
       路面是浅色的，所以垫一层深色底，不然白点和白线在直道上会糊掉。
       bottom 要给 .hud-help 那行按键提示（bottom: 8px）让开位置 */
    .race-track {
      position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%);
      width: min(46vw, 520px); height: 18px;
      padding: 0 10px; box-sizing: content-box;
      background: rgba(13,17,27,0.45); border-radius: var(--k-r-pill);
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    }
    .race-track-line {
      position: absolute; left: 10px; right: 10px; top: 50%; height: 4px;
      margin-top: -2px; border-radius: 2px;
      background: rgba(255,255,255,0.28);
    }
    /* 起点/终点线：进度条的两端 */
    .race-track-line::before, .race-track-line::after {
      content: ''; position: absolute; top: -3px; width: 2px; height: 10px;
      background: rgba(255,255,255,0.8);
    }
    .race-track-line::before { left: 0; }
    .race-track-line::after { right: 0; }
    /* 圆点用 calc 把 0%~100% 映射到横线的两端（横线两边各让开 10px 内边距） */
    .race-dot {
      position: absolute; top: 50%; width: 9px; height: 9px;
      margin: -4.5px 0 0 -4.5px; border-radius: 50%;
      background: #fff; box-shadow: 0 0 0 1.5px rgba(0,0,0,0.55);
      transition: left 90ms linear;
    }
    /* 玩家的点大一圈、带白环，一眼找得到自己 */
    .race-dot-me {
      width: 13px; height: 13px; margin: -6.5px 0 0 -6.5px; z-index: 1;
      box-shadow: 0 0 0 2px #fff, 0 0 8px rgba(0,0,0,0.6);
    }

    /* 触屏：左上角那一列也要让开刘海 */
    body.touch-input .race-lap { left: calc(20px + env(safe-area-inset-left)); }
    body.touch-input .race-pos { left: calc(20px + env(safe-area-inset-left)); }
    /* 左手布局：道具键跑到左上角去了，所以右上的计时面板不用再让位，
       反过来左上的圈数/名次要给它让开 */
    body.touch-input.touch-left-handed .race-times {
      right: calc(18px + env(safe-area-inset-right));
    }
    body.touch-input.touch-left-handed .race-lap,
    body.touch-input.touch-left-handed .race-pos {
      left: calc(30px + clamp(58px, 12vmin, 92px) + env(safe-area-inset-left));
    }

    @media (max-width: 640px) {
      .race-lap-value { font-size: 30px; }
      .race-pos-value { font-size: 40px; }
      .race-row-cur .race-v { font-size: 20px; }
      .race-v { font-size: 14px; }
      .race-center-count { font-size: 92px; }
      .race-center-go { font-size: 76px; }
      .race-pop-time { font-size: 40px; }
      .race-results { min-width: 0; padding: 18px 20px 16px; }
      .race-res-total { font-size: 38px; }
    }
  `,document.head.appendChild(e)}var xs=class{root;bar;label;percent;constructor(e){Zo(),Cs(),this.root=document.createElement(`div`),this.root.className=`loading-screen`,this.root.innerHTML=`
      <div class="loading-box">
        <div class="loading-title k-outline-lg">KART</div>
        <div class="loading-bar"><div class="loading-fill"></div></div>
        <div class="loading-foot">
          <span class="loading-label">准备中…</span>
          <span class="loading-percent k-num">0%</span>
        </div>
      </div>
    `,e.appendChild(this.root),this.bar=this.root.querySelector(`.loading-fill`),this.label=this.root.querySelector(`.loading-label`),this.percent=this.root.querySelector(`.loading-percent`)}update(e){let t=Math.round(e.ratio*100);this.bar.style.width=`${t}%`,this.percent.textContent=`${t}%`,this.label.textContent!==e.label&&(this.label.textContent=e.label)}hide(){this.root.classList.add(`is-hidden`),this.root.addEventListener(`transitionend`,()=>this.root.remove(),{once:!0}),setTimeout(()=>this.root.remove(),1200)}},Ss=!1;function Cs(){if(Ss)return;Ss=!0;let e=document.createElement(`style`);e.textContent=`
    .loading-screen {
      position: fixed; inset: 0; z-index: 100;
      display: flex; align-items: center; justify-content: center;
      /* 和主菜单同一片天：菜单 -> 加载 -> 赛道，底色是连续的 */
      background: radial-gradient(120% 90% at 50% 12%, #7fc4f2 0%, #3f7fc0 48%, #16233a 100%);
      color: var(--k-text); font-family: var(--k-font);
      transition: opacity 320ms ease;
    }
    .loading-screen.is-hidden { opacity: 0; pointer-events: none; }
    .loading-box { width: min(72vw, 420px); }
    .loading-title {
      font-size: clamp(38px, 9vw, 56px); font-weight: 900; letter-spacing: 10px;
      text-align: center; margin: 0 -10px 22px 0;
    }
    .loading-bar {
      height: 8px; border-radius: var(--k-r-pill); overflow: hidden;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.16);
    }
    .loading-fill {
      height: 100%; width: 0%; border-radius: var(--k-r-pill);
      background: linear-gradient(90deg, var(--k-accent), var(--k-gold));
      transition: width 110ms ease;
    }
    .loading-foot {
      display: flex; justify-content: space-between;
      margin-top: 12px; font-size: 12px; color: rgba(255,255,255,0.78);
    }
  `,document.head.appendChild(e)}var ws=.5;function Ts(e,t={}){let n=t.size??100,r=t.padding??6,i=e.length;if(i<3)return{path:``,start:{x:n/2,y:n/2},scale:1};let a=1/0,o=-1/0,s=1/0,c=-1/0;for(let[t,,n]of e)t<a&&(a=t),t>o&&(o=t),n<s&&(s=n),n>c&&(c=n);let l=Math.max(o-a,c-s,1e-6),u=(n-r*2)/l,d=r+(n-r*2-(o-a)*u)/2,f=r+(n-r*2-(c-s)*u)/2,p=e.map(e=>({x:Ds((e[0]-a)*u+d),y:Ds((c-e[2])*u+f)})),m=`M${p[0].x} ${p[0].y}`;for(let e=0;e<i;e++){let t=p[(e-1+i)%i],n=p[e],r=p[(e+1)%i],a=p[(e+2)%i],o=Ds(n.x+(r.x-t.x)*ws/3),s=Ds(n.y+(r.y-t.y)*ws/3),c=Ds(r.x-(a.x-n.x)*ws/3),l=Ds(r.y-(a.y-n.y)*ws/3);m+=`C${o} ${s} ${c} ${l} ${r.x} ${r.y}`}return m+=`Z`,{path:m,start:p[0],scale:u}}function Es(e,t={}){let n=t.size??100,{path:r,start:i}=Ts(e,t);if(!r)return``;let a=t.roadColor??`currentColor`,o=t.baseColor??`rgba(0,0,0,0.45)`,s=t.startColor??`#ffffff`;return`<svg viewBox="0 0 ${n} ${n}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${r}" fill="none" stroke="${o}" stroke-width="7" stroke-linejoin="round"/><path d="${r}" fill="none" stroke="${a}" stroke-width="3.4" stroke-linejoin="round"/><circle cx="${i.x}" cy="${i.y}" r="4" fill="${s}" stroke="${o}" stroke-width="1.5"/></svg>`}function Ds(e){return Math.round(e*100)/100}var Os=class{options;root;trackCards=new Map;cupCards=new Map;modeButtons=new Map;qualityButtons=new Map;trackList;cupList;startButton;selection;quality;constructor(e,t){this.options=t,Zo(),Ms(),this.selection={...t.initial},this.quality=t.quality,this.root=document.createElement(`div`),this.root.className=`menu`,this.root.innerHTML=`
      <div class="menu-inner">
        <div class="menu-head">
          <div class="menu-title k-outline-lg">KART</div>
          <div class="k-seg menu-modes"></div>
          <div class="menu-mode-sub"></div>
        </div>
        <div class="menu-tracks"></div>
        <div class="menu-cups"></div>
        <div class="menu-quality">
          <span class="menu-quality-label">画质</span>
          <div class="k-seg menu-quality-seg"></div>
        </div>
        <button class="k-btn menu-start" type="button">开始比赛</button>
        <div class="menu-foot"></div>
      </div>
    `,e.appendChild(this.root),this.trackList=this.root.querySelector(`.menu-tracks`),this.cupList=this.root.querySelector(`.menu-cups`),this.startButton=this.root.querySelector(`.menu-start`);let n=this.root.querySelector(`.menu-modes`);for(let e of ft)n.appendChild(this.addSegButton(dt[e].name,()=>{this.selection={...this.selection,mode:e},this.options.onSelect?.(this.selection),this.refresh()},this.modeButtons,e));for(let e of st)this.trackList.appendChild(this.buildTrackCard(e));for(let e of xt)this.cupList.appendChild(this.buildCupCard(e));let r=this.root.querySelector(`.menu-quality-seg`);for(let e of[`auto`,`high`,`medium`,`low`])r.appendChild(this.addSegButton(ks[e],()=>{this.quality=e,this.options.onQuality(e),this.refresh()},this.qualityButtons,e));this.startButton.addEventListener(`click`,()=>this.options.onStart(this.selection)),this.refresh()}addSegButton(e,t,n,r){let i=document.createElement(`button`);return i.type=`button`,i.textContent=e,i.addEventListener(`click`,t),n.set(r,i),i}buildTrackCard(e){let t=ot[e],n=document.createElement(`button`);n.type=`button`,n.className=`menu-card menu-card-track`;let r=[1,2,3].map(e=>e<=t.difficulty?`●`:`○`).join(``);return n.innerHTML=`
      <span class="menu-thumb" style="color:${t.sky.horizon}">${Es(t.points,{size:100,roadColor:`currentColor`})}</span>
      <span class="menu-card-body">
        <span class="menu-card-top">
          <span class="menu-card-name">${As(t.name)}</span>
          <span class="menu-card-diff">${r}</span>
        </span>
        <span class="menu-card-sub">${As(t.subtitle)}</span>
        <span class="menu-card-meta">
          <span>${t.laps} 圈</span>
          <span class="menu-card-record k-num"></span>
        </span>
      </span>
    `,n.addEventListener(`click`,()=>{this.selection={...this.selection,trackId:e},this.options.onSelect?.(this.selection),this.refresh()}),this.trackCards.set(e,n),n}buildCupCard(e){let t=bt[e],n=document.createElement(`button`);return n.type=`button`,n.className=`menu-card menu-card-cup`,n.innerHTML=`
      <span class="menu-cup-tracks">${t.trackIds.map(e=>`<i class="menu-cup-chip" style="color:${ot[e].sky.horizon}">${Es(ot[e].points,{size:100,roadColor:`currentColor`,baseColor:`rgba(0,0,0,0.35)`})}</i>`).join(``)}</span>
      <span class="menu-card-body">
        <span class="menu-card-top">
          <span class="menu-card-name">${As(t.name)}</span>
          <span class="menu-card-diff">${t.trackIds.length} 场</span>
        </span>
        <span class="menu-card-sub">${As(t.subtitle)}</span>
        <span class="menu-card-meta"><span class="menu-cup-progress"></span></span>
      </span>
    `,n.addEventListener(`click`,()=>{this.selection={...this.selection,cupId:e},this.options.onSelect?.(this.selection),this.refresh()}),this.cupCards.set(e,n),n}refresh(){let e=dt[this.selection.mode];for(let[e,t]of this.modeButtons)t.classList.toggle(`is-on`,e===this.selection.mode);this.root.querySelector(`.menu-mode-sub`).textContent=e.subtitle,this.trackList.hidden=e.cup,this.cupList.hidden=!e.cup;for(let[t,n]of this.trackCards){n.classList.toggle(`is-on`,t===this.selection.trackId);let r=n.querySelector(`.menu-card-record`),i=e.ghost?this.options.ghostLapOf(t):this.options.bestLapOf(t);r.textContent=`${e.ghost?`幽灵`:`最佳`} ${Ya(i)}`}let t=this.options.cupInProgress;for(let[e,n]of this.cupCards){n.classList.toggle(`is-on`,e===this.selection.cupId);let r=n.querySelector(`.menu-cup-progress`),i=t&&t.cupId===e?t:null,a=i!==null&&!kt(i);r.textContent=a?`进行中 · 第 ${Dt(i)} / ${Ot(i)} 场`:i?`已完成 · 再开一次从头算`:`未开始`,r.classList.toggle(`is-running`,!!a)}for(let[e,t]of this.qualityButtons)t.classList.toggle(`is-on`,e===this.quality);this.startButton.textContent=this.startLabel(),this.renderFoot()}startLabel(){let e=this.options.cupInProgress;return this.selection.mode===`cup`&&e&&e.cupId===this.selection.cupId?kt(e)?`重新开始杯赛`:`继续杯赛 · 第 ${Dt(e)} 场`:this.selection.mode===`timeTrial`?`开始计时`:`开始比赛`}renderFoot(){let e=this.root.querySelector(`.menu-foot`);e.textContent=``;let t=this.options.cupInProgress;if(t&&!kt(t)){let n=document.createElement(`div`);n.textContent=`${bt[t.cupId].name}进行到第 ${Dt(t)} / ${Ot(t)} 场。`;let r=document.createElement(`button`);r.type=`button`,r.className=`menu-link`,r.textContent=`放弃进度`,r.addEventListener(`click`,()=>{this.options.onAbandonCup(),this.refresh()}),n.appendChild(r),e.appendChild(n)}let n=this.quality===`auto`?`自动挡当前判定为「${ks[this.options.detectedTier]}」，`:``,r=document.createElement(`div`);r.textContent=`${n}对手数量跟着画质走（高 7 / 中 5 / 低 3），开局后改不了。操作、按键和音量在比赛里的左上角 ⚙ 里调。`,e.appendChild(r)}hide(){this.root.classList.add(`is-hidden`),this.root.addEventListener(`transitionend`,()=>this.root.remove(),{once:!0}),setTimeout(()=>this.root.remove(),800)}dispose(){this.root.remove()}},ks={auto:`自动`,high:`高`,medium:`中`,low:`低`};function As(e){return e.replace(/[&<>]/g,e=>e===`&`?`&amp;`:e===`<`?`&lt;`:`&gt;`)}var js=!1;function Ms(){if(js)return;js=!0;let e=document.createElement(`style`);e.textContent=`
    .menu {
      position: fixed; inset: 0; z-index: 90;
      display: flex; align-items: center; justify-content: center;
      padding: calc(20px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right))
               calc(20px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));
      font-family: var(--k-font); color: var(--k-text);
      /* 底色和天空同一个色系：菜单退场之后接上的就是这片天，不会"换了个世界" */
      background: radial-gradient(120% 90% at 50% 12%, #7fc4f2 0%, #3f7fc0 48%, #16233a 100%);
      transition: opacity 300ms ease;
      overflow-y: auto;
    }
    .menu.is-hidden { opacity: 0; pointer-events: none; }
    .menu-inner {
      width: min(94vw, 580px);
      display: flex; flex-direction: column; align-items: center; gap: 14px;
      margin: auto;
    }
    .menu-head { text-align: center; width: 100%; }
    .menu-title {
      font-size: clamp(44px, 11vw, 80px); font-weight: 900;
      letter-spacing: 10px; line-height: 1; margin-right: -10px;
    }
    .menu-head .k-seg { margin-top: 12px; }
    .menu-mode-sub { margin-top: 8px; font-size: 13px; color: rgba(255,255,255,0.78); }

    .menu-tracks, .menu-cups { width: 100%; display: flex; flex-direction: column; gap: 9px; }
    .menu-tracks[hidden], .menu-cups[hidden] { display: none; }

    .menu-card {
      pointer-events: auto; width: 100%; text-align: left; cursor: pointer;
      font-family: inherit; color: var(--k-text);
      background: rgba(13,17,27,0.42);
      border: 2px solid rgba(255,255,255,0.14);
      border-radius: var(--k-r-md);
      padding: 10px 14px;
      display: flex; align-items: center; gap: 12px;
      -webkit-tap-highlight-color: transparent;
      transition: border-color 130ms ease, background 130ms ease, transform 130ms ease;
    }
    .menu-card:hover { transform: translateY(-1px); background: rgba(13,17,27,0.55); }
    /* 选中的卡片：边框换成强调色 + 一圈外发光。只靠背景色变化在小屏上看不出来 */
    .menu-card.is-on {
      border-color: var(--k-accent);
      background: rgba(47,168,255,0.18);
      box-shadow: 0 0 0 4px rgba(47,168,255,0.18);
    }
    .menu-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .menu-card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .menu-card-name { font-size: 18px; font-weight: 800; letter-spacing: 1px; }
    .menu-card-diff { font-size: 11px; letter-spacing: 2px; color: var(--k-gold); flex: none; }
    .menu-card-sub { font-size: 12px; color: var(--k-text-dim); }
    .menu-card-meta {
      display: flex; justify-content: space-between; gap: 12px;
      font-size: 12px; color: rgba(255,255,255,0.7);
    }
    .menu-card-record { color: var(--k-gold); }

    /* 缩略图：赛道形状是从控制点现算的 SVG，颜色跟着那条道的天空色 */
    .menu-thumb {
      flex: none; width: 56px; height: 56px; display: block;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    }
    .menu-thumb svg { width: 100%; height: 100%; display: block; }

    /* 杯赛卡片：四条道的缩略图排成一列 */
    .menu-cup-tracks { flex: none; display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
    .menu-cup-chip { width: 27px; height: 27px; display: block; }
    .menu-cup-chip svg { width: 100%; height: 100%; display: block; }
    .menu-cup-progress { color: var(--k-text-dim); }
    .menu-cup-progress.is-running { color: var(--k-mint); font-weight: 700; }

    .menu-quality { display: flex; align-items: center; gap: 10px; width: 100%; }
    .menu-quality-label { font-size: 12px; color: var(--k-text-dim); flex: none; }
    .menu-quality .k-seg { flex: 1; }

    .menu-start { min-width: 240px; font-size: 18px; padding: 14px 36px; }
    .menu-foot {
      font-size: 12px; color: rgba(255,255,255,0.62);
      text-align: center; line-height: 1.7; display: flex; flex-direction: column; gap: 4px;
    }
    .menu-link {
      pointer-events: auto; margin-left: 6px; padding: 0;
      background: none; border: none; cursor: pointer;
      font-family: inherit; font-size: inherit;
      color: var(--k-gold); text-decoration: underline;
    }

    @media (max-height: 620px) {
      .menu-title { font-size: 38px; }
      .menu-inner { gap: 9px; }
      .menu-card { padding: 7px 12px; }
      .menu-card-sub { display: none; }
      .menu-thumb { width: 42px; height: 42px; }
    }
  `,document.head.appendChild(e)}function Ns(e,t){Zo(),Is();let n=document.createElement(`div`);n.className=`fatal`,n.innerHTML=`
    <div class="fatal-box k-panel">
      <div class="fatal-icon">⚠</div>
      <div class="fatal-title">${Ps(t.title)}</div>
      <div class="fatal-message">${Ps(t.message)}</div>
      <div class="fatal-actions">
        ${t.canRetry?`<button class="k-btn fatal-retry" type="button">重新加载</button>`:``}
        ${t.diagnostics?`<button class="k-btn k-btn-ghost fatal-copy" type="button">复制诊断信息</button>`:``}
      </div>
      <pre class="fatal-details" hidden></pre>
    </div>
  `,e.appendChild(n),n.querySelector(`.fatal-retry`)?.addEventListener(`click`,()=>location.reload());let r=n.querySelector(`.fatal-copy`),i=n.querySelector(`.fatal-details`);r?.addEventListener(`click`,()=>{let e=t.diagnostics?.()??``;navigator.clipboard?.writeText(e).then(()=>{r.textContent=`已复制 ✓`,setTimeout(()=>r.textContent=`复制诊断信息`,2e3)}).catch(()=>{i.textContent=e,i.hidden=!1,r.textContent=`复制不了，请手动选中下面的文字`})})}function Ps(e){return e.replace(/[&<>]/g,e=>e===`&`?`&amp;`:e===`<`?`&lt;`:`&gt;`)}var Fs=!1;function Is(){if(Fs)return;Fs=!0;let e=document.createElement(`style`);e.textContent=`
    .fatal {
      position: fixed; inset: 0; z-index: 200;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      background: radial-gradient(120% 90% at 50% 20%, #26364d 0%, #131a26 60%, #0b0f16 100%);
      font-family: var(--k-font); color: var(--k-text);
      overflow-y: auto;
    }
    .fatal-box {
      width: min(92vw, 520px); padding: 28px 30px 24px;
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      text-align: center;
    }
    .fatal-icon { font-size: 40px; line-height: 1; color: var(--k-gold); }
    .fatal-title { font-size: 22px; font-weight: 800; letter-spacing: 1px; }
    .fatal-message { font-size: 14px; line-height: 1.7; color: rgba(255,255,255,0.82); white-space: pre-line; }
    .fatal-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
    .fatal-details {
      width: 100%; max-height: 30vh; overflow: auto; margin-top: 10px;
      padding: 10px; border-radius: var(--k-r-sm);
      background: rgba(0,0,0,0.45); border: 1px solid var(--k-panel-line);
      font-family: var(--k-font-num); font-size: 11px; line-height: 1.5;
      text-align: left; white-space: pre-wrap; word-break: break-word;
      /* 这一块是给人**选中复制**的，所以要把全局的 user-select: none 抢回来 */
      -webkit-user-select: text; user-select: text;
    }
  `,document.head.appendChild(e)}var Ls={auto:`自动`,high:`高`,medium:`中`,low:`低`},Rs={auto:`自动`,keyboard:`键盘`,touch:`触屏`},zs=class{options;root;panel;note;toggleButton;muteButton;keyList;keysTag;dangerButton;qualityButtons=new Map;inputButtons=new Map;handedButtons=new Map;open=!1;bindings;capturing=null;confirmingReset=!1;confirmTimer=0;constructor(e,t){this.options=t,Zo(),Hs(),this.root=document.createElement(`div`),this.root.className=`settings`,this.root.innerHTML=`
      <button class="settings-toggle" type="button" aria-label="设置">⚙</button>
      <div class="settings-panel k-panel">
        <div class="settings-row">
          <div class="settings-label">画质</div>
          <div class="k-seg settings-quality"></div>
        </div>
        <div class="settings-row">
          <div class="settings-label">操作</div>
          <div class="k-seg settings-input"></div>
        </div>
        <div class="settings-row">
          <div class="settings-label">音量</div>
          <input class="k-range settings-master" type="range" min="0" max="1" step="0.05" aria-label="总音量" />
          <button class="settings-mute k-btn k-btn-ghost" type="button" aria-label="静音">🔊</button>
        </div>
        <div class="settings-row">
          <div class="settings-label">音乐</div>
          <input class="k-range settings-music" type="range" min="0" max="1" step="0.05" aria-label="音乐音量" />
        </div>
        <div class="settings-row settings-row-handed">
          <div class="settings-label">布局</div>
          <div class="k-seg settings-handed"></div>
        </div>
        <details class="settings-keys">
          <summary>按键映射<span class="settings-keys-tag"></span></summary>
          <div class="settings-keys-list"></div>
          <button class="settings-keys-reset" type="button">恢复默认按键</button>
        </details>
        <div class="settings-note"></div>
        <button class="settings-danger" type="button">清空本地记录</button>
      </div>
    `,e.appendChild(this.root),this.panel=this.root.querySelector(`.settings-panel`),this.note=this.root.querySelector(`.settings-note`),this.toggleButton=this.root.querySelector(`.settings-toggle`),this.muteButton=this.root.querySelector(`.settings-mute`),this.keyList=this.root.querySelector(`.settings-keys-list`),this.keysTag=this.root.querySelector(`.settings-keys-tag`),this.dangerButton=this.root.querySelector(`.settings-danger`),this.bindings=ze(t.prefs.keys);let n=this.root.querySelector(`.settings-quality`);for(let e of[`auto`,`high`,`medium`,`low`])this.qualityButtons.set(e,this.addButton(n,Ls[e],()=>{this.options.onQuality(e),this.setQuality(e)}));let r=this.root.querySelector(`.settings-input`);for(let e of[`auto`,`keyboard`,`touch`])this.inputButtons.set(e,this.addButton(r,Rs[e],()=>{this.options.onInput(e),this.setInput(e)}));let i=this.root.querySelector(`.settings-master`),a=this.root.querySelector(`.settings-music`);i.value=String(t.prefs.volume),a.value=String(t.prefs.musicVolume),i.addEventListener(`input`,()=>this.options.onVolume(`master`,Number(i.value))),a.addEventListener(`input`,()=>this.options.onVolume(`music`,Number(a.value))),this.muteButton.addEventListener(`click`,()=>{let e=!this.options.prefs.muted;this.options.onMuted(e),this.setMuted(e)});let o=this.root.querySelector(`.settings-handed`);for(let e of[`right`,`left`])this.handedButtons.set(e,this.addButton(o,Bs[e],()=>{this.options.onHanded(e),this.setHanded(e)}));this.root.querySelector(`.settings-keys-reset`).addEventListener(`click`,()=>{this.applyBindings(ze(null))}),this.dangerButton.addEventListener(`click`,()=>this.onDangerClick()),this.toggleButton.addEventListener(`click`,()=>this.toggle()),this.renderKeys(),this.setHanded(t.prefs.handed),this.setQuality(t.prefs.quality),this.setInput(t.prefs.input),this.setMuted(t.prefs.muted)}addButton(e,t,n){let r=document.createElement(`button`);return r.type=`button`,r.textContent=t,r.addEventListener(`click`,n),e.appendChild(r),r}toggle(){this.open=!this.open,this.panel.classList.toggle(`is-open`,this.open),this.open||(this.cancelCapture(),this.resetDanger())}beginCapture(e,t,n){this.cancelCapture(),this.capturing={action:e,slot:t,button:n},n.classList.add(`is-capturing`),n.textContent=`按一个键…`,window.addEventListener(`keydown`,this.onCaptureKey,!0)}onCaptureKey=e=>{if(!this.capturing)return;e.preventDefault(),e.stopPropagation();let{action:t,slot:n}=this.capturing;e.code!==`Escape`&&Ke(e.code)&&this.applyBindings(He(this.bindings,t,n,e.code)),this.cancelCapture()};cancelCapture(){this.capturing&&(window.removeEventListener(`keydown`,this.onCaptureKey,!0),this.capturing=null,this.renderKeys())}applyBindings(e){this.bindings=e,this.options.onKeys(e),this.renderKeys()}renderKeys(){this.keyList.textContent=``;for(let e of Fe){let t=document.createElement(`div`);t.className=`settings-key-row`;let n=document.createElement(`span`);n.className=`settings-key-label`,n.textContent=Ie[e],t.appendChild(n);let r=document.createElement(`span`);r.className=`settings-key-slots`,this.bindings[e].forEach((t,n)=>{let i=document.createElement(`button`);i.type=`button`,i.className=`settings-key`,i.textContent=Ue(t),i.title=t,i.addEventListener(`click`,()=>this.beginCapture(e,n,i)),r.appendChild(i)}),t.appendChild(r),this.keyList.appendChild(t)}this.keysTag.textContent=Be(this.bindings)?``:` · 已改`}onDangerClick(){if(!this.confirmingReset){this.confirmingReset=!0,this.dangerButton.textContent=`真的清空？再点一次`,this.dangerButton.classList.add(`is-confirming`),clearTimeout(this.confirmTimer),this.confirmTimer=setTimeout(()=>this.resetDanger(),4e3);return}this.options.onResetRecords(),this.resetDanger(),this.dangerButton.textContent=`已清空`,setTimeout(()=>this.resetDanger(),2e3)}resetDanger(){clearTimeout(this.confirmTimer),this.confirmingReset=!1,this.dangerButton.textContent=`清空本地记录`,this.dangerButton.classList.remove(`is-confirming`)}setQuality(e){for(let[t,n]of this.qualityButtons)n.classList.toggle(`is-on`,t===e);this.refreshNote(e)}setInput(e){for(let[t,n]of this.inputButtons)n.classList.toggle(`is-on`,t===e)}setHanded(e){for(let[t,n]of this.handedButtons)n.classList.toggle(`is-on`,t===e)}setMuted(e){this.muteButton.textContent=e?`🔇`:`🔊`,this.muteButton.classList.toggle(`is-muted`,e)}setActiveTier(e,t){this.options.detectedTier=e,this.setQuality(t)}refreshNote(e){let t=e===`auto`?`（当前 ${Ls[this.options.detectedTier]}）`:``;this.note.textContent=`自动挡会按设备能力选档${t}，跑起来掉帧还会自动往下降。\n对手数量要重新载入页面才会跟着档位变，其它改动立刻生效。`}dispose(){this.cancelCapture(),clearTimeout(this.confirmTimer),this.root.remove()}},Bs={right:`右手（摇杆在左）`,left:`左手（摇杆在右）`},Vs=!1;function Hs(){if(Vs)return;Vs=!0;let e=document.createElement(`style`);e.textContent=`
    /* 左上角、FPS 读数那一条的右边。这一块是布局里唯一两种操作模式下都空着的地方：
       左下是速度表和虚拟摇杆，右下是按钮组，右上是道具键和调参面板 */
    .settings {
      position: absolute; z-index: 95;
      left: calc(136px + env(safe-area-inset-left));
      top: calc(14px + env(safe-area-inset-top));
      font-family: var(--k-font);
    }
    .settings-toggle {
      pointer-events: auto;
      width: 40px; height: 40px; border-radius: 50%;
      border: 1px solid var(--k-panel-line);
      background: rgba(13,17,27,0.55); color: var(--k-text);
      font-size: 18px; line-height: 1; cursor: pointer;
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      -webkit-tap-highlight-color: transparent;
      transition: transform 140ms ease;
    }
    .settings-toggle:active { transform: rotate(60deg); }
    .settings-panel {
      position: absolute; left: 0; top: 48px;
      width: 280px; padding: 14px;
      color: var(--k-text);
      display: none;
    }
    .settings-panel.is-open { display: block; }
    .settings-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .settings-label { font-size: 12px; color: var(--k-text-dim); width: 28px; flex: none; }
    .settings-row .k-seg { flex: 1; }
    /* 静音键复用 k-btn 的手感，但要收成一个正方形小键 */
    .settings-mute {
      flex: none; width: 34px; height: 34px; padding: 0;
      font-size: 15px; border-radius: var(--k-r-sm);
    }
    .settings-mute.is-muted { color: var(--k-danger); }
    .settings-note {
      font-size: 11px; color: var(--k-text-dim); line-height: 1.5; white-space: pre-line;
    }
    /* 触屏布局那一行只在触屏模式下有意义 */
    .settings-row-handed { display: none; }
    body.touch-input .settings-row-handed { display: flex; }
    .settings-row-handed .k-seg button { font-size: 11px; }

    /* 按键映射：默认折起来。它是一大块，展开着会把面板顶出屏幕 */
    .settings-keys { margin-bottom: 10px; }
    .settings-keys summary {
      cursor: pointer; font-size: 12px; color: var(--k-text-dim);
      padding: 4px 0; -webkit-tap-highlight-color: transparent;
    }
    .settings-keys-tag { color: var(--k-gold); }
    .settings-keys-list { display: flex; flex-direction: column; gap: 5px; margin: 6px 0 8px; }
    .settings-key-row { display: flex; align-items: center; gap: 8px; }
    .settings-key-label { font-size: 12px; color: var(--k-text-dim); flex: 1; min-width: 0; }
    .settings-key-slots { display: flex; gap: 4px; flex: none; }
    .settings-key {
      pointer-events: auto; min-width: 46px; padding: 4px 7px;
      font-family: var(--k-font); font-size: 11px; font-weight: 700;
      border-radius: var(--k-r-sm); cursor: pointer;
      border: 1px solid var(--k-panel-line);
      background: rgba(255,255,255,0.08); color: var(--k-text);
      -webkit-tap-highlight-color: transparent;
    }
    /* 等待按键时闪一下，不然玩家不知道该干什么 */
    .settings-key.is-capturing {
      background: var(--k-gold); color: var(--k-ink);
      border-color: var(--k-gold); animation: settings-blink 900ms ease-in-out infinite;
    }
    @keyframes settings-blink { 50% { opacity: 0.55; } }
    .settings-keys-reset {
      pointer-events: auto; width: 100%; padding: 6px 0;
      font-family: var(--k-font); font-size: 11px; cursor: pointer;
      border-radius: var(--k-r-sm); border: 1px solid var(--k-panel-line);
      background: rgba(255,255,255,0.06); color: var(--k-text-dim);
    }

    /* 清空记录：危险操作，放在最下面，颜色和别的键区分开 */
    .settings-danger {
      pointer-events: auto; width: 100%; margin-top: 10px; padding: 8px 0;
      font-family: var(--k-font); font-size: 12px; font-weight: 700; cursor: pointer;
      border-radius: var(--k-r-sm);
      border: 1px solid rgba(255,95,109,0.45);
      background: rgba(255,95,109,0.12); color: var(--k-danger);
      -webkit-tap-highlight-color: transparent;
    }
    .settings-danger.is-confirming {
      background: var(--k-danger); color: var(--k-ink); border-color: var(--k-danger);
    }
  `,document.head.appendChild(e)}var Us=class{root;timer=0;constructor(e){Zo(),Gs(),this.root=document.createElement(`div`),this.root.className=`toast`,e.appendChild(this.root)}show(e,t=3){this.root.textContent=e,this.root.classList.add(`is-visible`),clearTimeout(this.timer),this.timer=setTimeout(()=>this.root.classList.remove(`is-visible`),t*1e3)}dispose(){clearTimeout(this.timer),this.root.remove()}},Ws=!1;function Gs(){if(Ws)return;Ws=!0;let e=document.createElement(`style`);e.textContent=`
    .toast {
      position: absolute; left: 50%; transform: translateX(-50%);
      bottom: calc(84px + env(safe-area-inset-bottom));
      padding: 10px 18px; border-radius: var(--k-r-pill);
      background: var(--k-panel); color: var(--k-text);
      font-family: var(--k-font); font-size: 13px; font-weight: 600;
      border: 1px solid var(--k-panel-line);
      box-shadow: var(--k-shadow-chip);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      opacity: 0; pointer-events: none; z-index: 60;
      transition: opacity 220ms ease;
      max-width: min(80vw, 460px); text-align: center;
    }
    .toast.is-visible { opacity: 1; }
  `,document.head.appendChild(e)}var Ks=class{root;enabled=!1;query;onChange=null;constructor(e){Xs(),this.root=document.createElement(`div`),this.root.className=`device-overlay orientation-gate`,this.root.innerHTML=`
      <div class="device-overlay-box">
        <div class="device-overlay-icon">📱↻</div>
        <div class="device-overlay-title">请横屏游玩</div>
        <div class="device-overlay-text">把手机转过来，视野和虚拟摇杆都是按横屏排的</div>
      </div>
    `,e.appendChild(this.root),this.query=typeof matchMedia==`function`?matchMedia(`(orientation: portrait)`):null,this.query?.addEventListener(`change`,this.refresh),window.addEventListener(`resize`,this.refresh)}get isPortrait(){return this.query?this.query.matches:window.innerHeight>window.innerWidth}setEnabled(e){this.enabled=e,this.refresh()}refresh=()=>{let e=this.enabled&&this.isPortrait;this.root.classList.toggle(`is-visible`,e),this.onChange?.(e)};dispose(){this.query?.removeEventListener(`change`,this.refresh),window.removeEventListener(`resize`,this.refresh),this.root.remove()}};function qs(e,t,n={}){Xs();let r=document.createElement(`div`);r.className=`device-overlay context-lost`,r.innerHTML=`
    <div class="device-overlay-box">
      <div class="device-overlay-icon">⚠️</div>
      <div class="device-overlay-title">画面被系统回收了</div>
      <div class="device-overlay-text">手机内存吃紧时会发生。点下面的按钮重新载入。</div>
      <button class="device-overlay-btn" type="button">重新载入</button>
    </div>
  `,t.appendChild(r),r.querySelector(`button`).addEventListener(`click`,()=>location.reload());let i=e=>{e.preventDefault(),r.classList.add(`is-visible`),n.onLost?.()},a=()=>{r.classList.remove(`is-visible`),n.onRestored?.()};return e.addEventListener(`webglcontextlost`,i),e.addEventListener(`webglcontextrestored`,a),{dispose(){e.removeEventListener(`webglcontextlost`,i),e.removeEventListener(`webglcontextrestored`,a),r.remove()}}}function Js(e=document.body){let t=0,n=e=>e.preventDefault(),r=e=>{let n=Date.now();n-t<300&&e.preventDefault(),t=n},i=e=>{e.preventDefault()};return e.addEventListener(`gesturestart`,n),e.addEventListener(`gesturechange`,n),document.addEventListener(`touchend`,r,{passive:!1}),document.addEventListener(`touchmove`,i,{passive:!1}),{dispose(){e.removeEventListener(`gesturestart`,n),e.removeEventListener(`gesturechange`,n),document.removeEventListener(`touchend`,r),document.removeEventListener(`touchmove`,i)}}}var Ys=!1;function Xs(){if(Ys)return;Ys=!0;let e=document.createElement(`style`);e.textContent=`
    .device-overlay {
      position: fixed; inset: 0; z-index: 90;
      display: none; align-items: center; justify-content: center;
      background: rgba(8,11,17,0.94); color: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    }
    .device-overlay.is-visible { display: flex; }
    .device-overlay-box { text-align: center; max-width: 78vw; }
    .device-overlay-icon { font-size: 42px; margin-bottom: 14px; }
    .device-overlay-title { font-size: 19px; font-weight: 700; margin-bottom: 8px; }
    .device-overlay-text { font-size: 13px; opacity: 0.7; line-height: 1.6; }
    .device-overlay-btn {
      margin-top: 18px; padding: 10px 22px;
      border-radius: 9px; border: 1px solid rgba(255,255,255,0.25);
      background: #4d9bff; color: #06101f; font-weight: 700; font-family: inherit;
      font-size: 14px; cursor: pointer;
    }
  `,document.head.appendChild(e)}var j=document.getElementById(`app`),Zs=new jn;Zs.install();var M=Wt(Ut(),location.search),Qs=Ae(),{tier:N,settings:P,detected:$s}=tt(Qs,M.quality),ec=Pe(Qs,M.input),F=ec.mode;if(Zs.setContext(`画质`,`${M.quality} -> ${N}`),Zs.setContext(`GPU`,Qs.gpu||`(未知)`),Zs.setContext(`WebGL2`,String(Qs.webgl2)),!Qs.webgl2)throw Ns(j,{title:`这个浏览器跑不了`,message:`游戏需要 WebGL 2，而当前浏览器没有提供。
常见原因：浏览器版本太老、显卡驱动没装、或者在设置里关掉了硬件加速。
换成新版 Chrome / Edge / Safari 通常就能跑。`,diagnostics:()=>Zs.report()}),Error(`WebGL2 unavailable`);var I=new pa({settings:{master:M.volume,music:M.musicVolume,muted:M.muted},onSettingsChange:e=>{M.volume=e.master,M.musicVolume=e.music,M.muted=e.muted,T(M)}}),tc=new ya(I),nc=new It(Lt()),L=nc.load(),rc=`kart.cupAutoContinue`,ic=ac();function ac(){try{let e=sessionStorage.getItem(rc)===`1`;return e&&sessionStorage.removeItem(rc),e}catch{return!1}}var oc=ic&&L&&!kt(L)?{mode:`cup`,trackId:M.track,cupId:L.cupId}:await new Promise(e=>{let t=new Os(j,{initial:{mode:M.mode,trackId:M.track,cupId:M.cup},quality:M.quality,detectedTier:$s,cupInProgress:L,onQuality:e=>{M.quality=e,T(M),{tier:N,settings:P,detected:$s}=tt(Qs,M.quality)},bestLapOf:e=>new Ca(wa(),Sa(e)).best,ghostLapOf:e=>new Ra(za(),e).load()?.lapTime??null,onAbandonCup:()=>{nc.clear(),L=null},onSelect:e=>{M.mode=e.mode,M.track=e.trackId,M.cup=e.cupId,T(M)},onStart:n=>{M.mode=n.mode,M.track=n.trackId,M.cup=n.cupId,T(M),I.init(),I.play(`uiClick`),t.hide(),e(n)}})}),sc=dt[oc.mode];sc.cup?(!L||L.cupId!==oc.cupId||kt(L))&&(L=Tt(oc.cupId,P.aiCount),nc.save(L)):L=null;var R=ut((L&&Et(L))??oc.trackId);Zs.setContext(`赛道`,`${R.id} (${oc.mode})`);var cc=new xs(j),lc=new Ki([{id:`scene`,label:`生成赛道…`,weight:3},{id:`assets`,label:`下载资源…`,weight:2},{id:`physics`,label:`启动物理引擎…`,weight:4}],e=>cc.update(e)),uc=()=>new Promise(e=>requestAnimationFrame(()=>e()));await uc();var z=new se({antialias:P.antialias,powerPreference:`high-performance`});z.setSize(window.innerWidth,window.innerHeight),z.toneMapping=4,z.toneMappingExposure=1,z.shadowMap.type=1,z.info.autoReset=!1,j.appendChild(z.domElement);var dc=R.config,B=new Wn(R.points,dc.lutSamples),fc=new Pn(B,dc),pc=zn(B);pc.visible=!1;var mc=he(dc)+dc.wallThickness+7,V=new Si({groundY:dc.skirtBottomY,isBlocked:(e,t)=>Math.abs(B.getProgress(e,t).lateral)<mc,quality:P,sky:R.sky,decor:R.decor,renderer:z});V.scene.add(fc.group),V.scene.add(pc);var H=new jr(window.innerWidth/window.innerHeight),hc=new Ai(z,V.scene,H.camera,P),gc=_c(F);function _c(e){return document.body.classList.toggle(`touch-input`,e===`touch`),document.body.classList.toggle(`touch-left-handed`,M.handed===`left`),e===`touch`?new $t(j,{handed:M.handed}):new qt(window,M.keys)}function vc(e){let t=Pe(Qs,e);M.input=e,T(M),t.mode!==F&&(gc.dispose(),F=t.mode,gc=_c(F),xl.setEnabled(F===`touch`),F===`touch`&&Tl.setVisible(!1))}var U=cn(),W=`player`,yc=sc.ai?L?.aiCount??P.aiCount:0,bc=yc,xc=`normal`,Sc={body:`#ff3b30`,accent:`#ffcc00`,trim:`#f7f7fa`,suit:`#2f6fed`},Cc=pr(B),wc=qa(Cc,yc+1);function Tc(e){let t=B.getPointAt(e.t).y;return{x:e.x,z:e.z,y:t,heading:e.heading}}var Ec=()=>Tc(wc[bc]),Dc=[];for(let e=0;e<wc.length;e++)e!==bc&&Dc.push(e);var G=(()=>{let e=Ec();return dn(e.x,e.z,e.heading,e.y)})(),Oc={...G},K=Dc.map((e,t)=>new fr({id:`ai${t}`,persona:_t(t),difficulty:xc,track:Cc},Tc(wc[e]))),q=new Ho(Cc,new _o(R.itemBoxRows.flatMap(e=>{let t=B.getPointAt(e.t),n=B.getHeadingAt(e.t),r=Math.sin(n-Math.PI/2),i=Math.cos(n-Math.PI/2);return e.lanes.map(e=>({x:t.x+r*e,y:t.y,z:t.z+i*e}))})),{seed:19265}),kc=new Zr(Sc);V.scene.add(kc.root);var Ac=K.map(e=>{let t=new Zr({body:e.persona.color,accent:e.persona.accent,suit:e.persona.accent});return V.scene.add(t.root),t}),jc=[kc,...Ac],Mc=P.aiSparks?yc+1:1,Nc=new yr(P.sparkCapacity*Mc);V.scene.add(Nc.points);var Pc=P.dustCapacity>0?new br(P.dustCapacity*Mc):null;Pc&&V.scene.add(Pc.points);var J=new xr(P.burstCapacity);V.scene.add(J.points);var Fc=new Sr(yc+1);Fc.setVisible(P.boostTrail),V.scene.add(Fc.mesh);var Ic=new Oi(yc+2);V.scene.add(Ic.mesh);var Lc=new Ra(za(),R.id),Rc=sc.ghost?Lc.load():null,zc=Rc?new Oa(Rc):null,Bc=zc?.valid?new Zr(Sc,{ghost:!0}):null;Bc&&V.scene.add(Bc.root);var Vc=sc.recordGhost?new Da:null,Hc={x:0,y:0,z:0,heading:0},Y=dn();function Uc(){let e=z.getDrawingBufferSize(new l).y;Nc.setViewportHeight(e),Pc?.setViewportHeight(e),J.setViewportHeight(e)}H.snapTo(G,U),kc.update(G,U,1/60);var Wc=[{id:W,name:`你`,isPlayer:!0,startT:wc[bc].t},...K.map((e,t)=>({id:e.id,name:e.persona.name,startT:wc[Dc[t]].t}))],X=new Ga(Wc,{totalLaps:R.laps});for(let e of Wc)q.register(e.id);var Gc=new Ca(wa(),Sa(R.id)),Kc=!1,qc=L,Jc=null,Z=un(),Yc=K.map(()=>un()),Xc={},Zc=[],Qc={...wn},$c=cn(),el=[],tl=K.map(()=>({hasItem:!1,offensive:!1,targetAhead:!1}));function nl(e,t){let n=[`chargeThresholds`,`boostSpeedMul`,`boostDuration`],r=n.map(t=>e[t]);Object.assign(e,t),n.forEach((n,i)=>{let a=r[i],o=t[n];a[0]=o[0],a[1]=o[1],a[2]=o[2],e[n]=a})}function rl(e,t){for(let n of el){if(n.id===t)continue;let r=((n.trackT-e)%1+1)%1;if(r>0&&r<.12)return!0}return!1}var il=new Go(q.boxes.boxes);il.group.visible=sc.items;var al=new Jo,ol=new Yo;V.scene.add(il.group),V.scene.add(al.group),V.scene.add(ol.group);var sl=new $o(j),cl=new as(j);cl.setVisible(sc.items);var ll=new ps(j,{onRestart:()=>wl(),onChangeTrack:()=>{I.play(`uiClick`),T(M),location.reload()},onNextRound:()=>{I.play(`uiClick`),T(M);try{sessionStorage.setItem(rc,`1`)}catch{}location.reload()}}),ul=new Us(j),dl=Io(),fl=Lo(),pl=Ro(yc,xc),ml=zo(),Q=Bo(N);function hl(e){N=e,P=Je[e],z.setPixelRatio(nt(P,window.devicePixelRatio)),z.setSize(window.innerWidth,window.innerHeight),z.shadowMap.enabled=P.shadowMapSize>0,V.setQuality(P),hc.setQuality(P),hc.setSize(window.innerWidth,window.innerHeight),Ic.setVisible(P.blobShadows),H.camera.far=P.cameraFar,H.camera.updateProjectionMatrix(),Fc.setVisible(P.boostTrail),Uc(),Q.tier=e,yl.reset()}function gl(e){M.quality=e,T(M),hl(e===`auto`?$s:e),bl.setActiveTier(N,e)}function _l(){let e=Ze(N);e&&(hl(e),M.quality=e,T(M),bl.setActiveTier(e,e),ul.show(`帧率不够，画质已降到「${vl[e]}」（左下角设置里可以调回去）`,4))}var vl={high:`高`,medium:`中`,low:`低`},yl=new Mi,bl=new zs(j,{prefs:M,detectedTier:$s,detectedInput:ec.detected,onQuality:gl,onInput:vc,onVolume:(e,t)=>I.setVolume(e,t),onMuted:e=>I.setMuted(e),onKeys:e=>{M.keys=e,T(M),gc instanceof qt&&gc.setBindings(e)},onHanded:e=>{M.handed=e,T(M),document.body.classList.toggle(`touch-left-handed`,e===`left`),gc instanceof $t&&gc.setHanded(e)},onResetRecords:()=>{for(let e of st)new Ca(wa(),Sa(e)).clear(),new Ra(za(),e).clear();nc.clear(),ul.show(`本地记录已清空（圈速、幽灵车、杯赛进度）`,3)}}),xl=new Ks(j);xl.setEnabled(F===`touch`),xl.onChange=e=>{e?Sl?.stop():Cl&&Sl?.start()},qs(z.domElement,j,{onLost:()=>Sl?.stop(),onRestored:()=>{Cl&&Sl?.start(),ul.show(`画面已恢复`,2)}}),Qs.maxTouchPoints>0&&Js();var Sl=null,Cl=!1,wl=()=>{let e=Ec();G=dn(e.x,e.z,e.heading,e.y),Oc={...G},H.snapTo(G,U),K.forEach((e,t)=>e.respawn(Tc(wc[Dc[t]]))),X.restart(),q.reset(),Kc=!1,Jc=null,Vc?.reset(),Nc.clear(),Pc?.clear(),J.clear(),Fc.clear(),tc.reset()},Tl=new Vo({kart:U,camera:H.config,view:kc.config,track:dl,race:fl,collision:Qc,ai:pl,item:ml,itemBox:q.boxes.config,projectile:q.projectileConfig,perf:Q,onGrantItem:()=>q.grant(W,ml.forceItem),onAIChanged:()=>{for(let e of K)e.setDifficulty(pl.difficulty),e.rubberbandEnabled=pl.rubberband},onResetKart:wl,onClearRecord:()=>Gc.clear()});F===`touch`&&Tl.setVisible(!1),window.addEventListener(`keydown`,e=>{e.code===`KeyR`&&wl()});function El(e){switch(tc.onKartEvent(e),e.type){case`boostStart`:H.punch(H.config.punchFov*(.6+.2*e.level));break;case`driftLevelUp`:kc.getTailWorldPosition($),J.burst($.x,$.y,$.z,`#${yr.LEVEL_COLORS[e.level-1].getHexString()}`,.35,8)}}var $=new o;function Dl(e){return e===W?G:K.find(t=>t.id===e)?.current??null}function Ol(){for(let e of X.consumeEvents())switch(tc.onRaceEvent(e,W),e.type){case`go`:ll.showGo();break;case`lap`:{let t=e.id===W&&Gc.submit(e.time);if(t&&(Kc=!0,tc.onNewRecord()),e.id===W){ll.showLapSplit(e.lap,e.time,e.best,t);let n=Vc?.finish(e.time);n&&Lc.saveIfFaster(n)&&ul.show(`幽灵车已更新（${Ya(e.time)}）`,2.5),Vc?.reset()}break}case`raceFinished`:{let e=X.getProgress(W);if(Jc={place:X.getStanding(W)?.place??1,totalTime:e.totalTime,lapTimes:[...e.lapTimes],bestLap:e.bestLap,newRecord:Kc,standings:Al()},qc){let t={};for(let e of X.standings)t[e.id]=e.place;L=At(qc,{trackId:R.id,places:t,playerTime:e.totalTime}),nc.save(L)}break}}}var kl=new Map([[W,Sc.body]]);for(let e of K)kl.set(e.id,e.persona.color);function Al(){return X.standings.map(e=>({place:e.place,name:e.name,isPlayer:e.isPlayer,color:kl.get(e.id)??`#ffffff`,finishTime:e.finishTime,lap:e.lap,finished:e.finished}))}function jl(){if(!zc||!Bc)return null;let e=Z.progress-B.getProgress(Y.x,Y.z).t;return e>.5?--e:e<-.5&&(e+=1),e*B.length}function Ml(){return!L||!qc?null:{name:bt[L.cupId].name,round:Dt(qc),total:Ot(qc),finished:kt(L),standings:jt(L).map(e=>({name:e.name,color:e.color,isPlayer:e.isPlayer,place:e.place,points:e.points,rounds:e.rounds}))}}var Nl=[];function Pl(){Nl.length=0;for(let e of X.standings){let t=X.getProgress(e.id);t&&Nl.push({id:e.id,t:t.t,color:kl.get(e.id)??`#ffffff`,isPlayer:e.isPlayer})}return Nl}function Fl(){for(let e of q.consumeEvents())switch(tc.onItemEvent(e,W),e.type){case`pickup`:e.kartId===W&&cl.playRoll();break;case`use`:break;case`hit`:{let t=Dl(e.kartId);t&&J.burst(t.x,t.y+.7,t.z,k.danger,1,26),e.kartId===W&&(H.punch(-H.config.punchFov*.5),H.shake(1));break}case`blocked`:{let t=Dl(e.kartId);t&&J.burst(t.x,t.y+.7,t.z,k.mint,.7,14);break}}}var Il=new Map,Ll=[];function Rl(){let e=q.held(W),t=q.effectsOf(W).list(),n=Ll;n.length=0;for(let e of t){let t=Il.get(e.type)??0,r=e.duration>t?e.duration:t;Il.set(e.type,r),n.push({type:e.type,remaining:e.duration,total:r})}for(let e of[...Il.keys()])t.some(t=>t.type===e)||Il.delete(e);return{held:e?xo[e]:null,effects:n,rolling:!1}}var zl=[`蓄力中`,`一档`,`二档`,`三档`];function Bl(e){return e.airborne?`坠落中…`:e.boostTime>0?`BOOST ${e.boostLevel}档 ${e.boostTime.toFixed(1)}s`:e.driftPhase===`drifting`?zl[e.driftLevel]:`—`}var Vl=(e,t)=>{let n=10**t;return Math.round(e*n)/n},Hl=[],Ul=0,Wl=0;function Gl(){let e=0,t=(Qc.radius*2)**2;for(let n of K){if(Math.abs(n.current.y-G.y)>Qc.maxHeightDiff)continue;let r=n.current.x-G.x,i=n.current.z-G.z;r*r+i*i<t&&e++}return e}function Kl(e,t,n,r,i,a,o){let s=t.driftPhase===`drifting`&&!t.airborne;if(o&&s&&t.driftLevel>0&&Nc.emit(r.getWheelWorldPositions(Hl,`rear`),t.driftLevel,a,i.height),o&&Pc&&!t.airborne){let e=Math.min(Math.abs(t.speed)/Math.max(n.maxSpeed,.001),1),o=Math.abs(t.lateralOffset)>dc.trackWidth/2,c=s?.5+.5*e:o?.35+.65*e:0;c>0&&Pc.emit(r.getWheelWorldPositions(Hl,o?`all`:`rear`),c,a,i.height,o)}if(P.boostTrail){r.getTailWorldPosition($);let n=Math.min(t.boostTime/.3,1),i=t.boostLevel>0?`#${yr.LEVEL_COLORS[t.boostLevel-1].getHexString()}`:k.gold;Fc.push(e,$.x,$.y,$.z,t.heading,n,i,a)}}function ql(e){return new De({fixedDt:1/60,update:t=>{Oc=G;let n=X.getProgress(W);e.sample(G.x,G.y,G.z,n.getLastCheckpoint().t,Z),Xc[W]=Z.progress;for(let t=0;t<K.length;t++){let n=K[t],r=Yc[t];e.sample(n.current.x,n.current.y,n.current.z,X.getProgress(n.id).getLastCheckpoint().t,r),Xc[n.id]=r.progress}X.update(t,Xc),el.length=0;let r=X.gateInput(W,gc.sample());el.push({id:W,state:G,trackT:Z.progress,place:X.getStanding(W)?.place??1,useItem:r.useItem});for(let e=0;e<K.length;e++){let t=K[e];el.push({id:t.id,state:t.current,trackT:Yc[e].progress,place:X.getStanding(t.id)?.place??1,useItem:t.wantsItem&&!X.isInputLocked(t.id)})}nl($c,U),q.effectsOf(W).applyTo($c),G=yn(G,r,Z,$c,t),Vc&&X.phase===`racing`&&(Hc.x=G.x,Hc.y=G.y,Hc.z=G.z,Hc.heading=G.heading,Vc.push(t,Hc));for(let e of Sn(Oc,G))El(e);let i=n.totalProgress;for(let e=0;e<K.length;e++){let n=K[e],r=X.getProgress(n.id).totalProgress-i,a=q.held(n.id),o=tl[e];o.hasItem=a!==null,o.offensive=a!==null&&xo[a].offensive,o.targetAhead=rl(Yc[e].progress,n.id),n.step(U,Yc[e],X.isInputLocked(n.id),r,t,o,q.effectsOf(n.id))}el[0].state=G;for(let e=0;e<K.length;e++)el[e+1].state=K[e].current;sc.items&&q.update(el,t),Zc.length=0,Zc.push(G);for(let e of K)Zc.push(e.current);On(Zc,Qc,t),Ul=Gl()},render:(e,t)=>{z.info.reset();let n=Cn(Oc,G,e);if(kc.update(n,U,t),H.update(n,U,t),V.followShadow(n.x,n.y,n.z),V.update(H.camera),Ul>Wl){let e=Math.min(Math.abs(n.speed)/Math.max(U.maxSpeed,.001),1);H.shake(.35+.4*e),J.burst(n.x,n.y+.6,n.z,`#ffffff`,.4,10)}Wl=Ul,Ic.begin(),Ic.add(n.x,Z.height,n.z,n.y-Z.height),Kl(0,n,U,kc,Z,t,!0);for(let n=0;n<K.length;n++){let r=K[n],i=Ac[n],a=Cn(r.previous,r.current,e);i.update(a,r.config,t);let o=Yc[n];Ic.add(a.x,o.height,a.z,a.y-o.height),Kl(n+1,a,r.config,i,o,t,P.aiSparks)}if(zc&&Bc){let e=zc.sampleAt(X.getProgress(W).lapTime);Y.x=e.x,Y.y=e.y,Y.z=e.z,Y.heading=e.heading,Y.speed=U.maxSpeed*.8,Bc.update(Y,U,t),Ic.add(Y.x,Y.y,Y.z,0)}Ic.finish(),Nc.step(t),Pc?.step(t),J.step(t),Fc.flush(),il.update(q.boxes.boxes,t),al.update(q.projectiles,t),ol.update(q.traps,t);let r=Math.min(n.boostTime/.35,1)*.85;sl.update(n.speed,t,r,Bl(n)),tc.update({state:n,config:U,halfWidth:Z.halfWidth,contacts:Ul,racing:X.phase===`racing`,frameDt:t}),Fl(),cl.update(Rl(),t),Ol();let i=X.getProgress(W);ll.update({phase:X.phase,lap:i.lap+1,totalLaps:X.config.totalLaps,lapTime:i.lapTime,lastLap:i.lastLap,bestLap:i.bestLap,recordLap:Gc.best,countdown:X.countdown,lapValid:i.lapValid,place:X.getStanding(W)?.place??1,racerCount:X.racerCount,standings:X.standings,dots:Pl(),results:Jc,cup:Ml(),ghostGap:jl()},t),pc.visible=dl.showCenterLine,dl.progress=Vl(n.trackProgress,4),dl.lateral=Vl(n.lateralOffset,2),dl.airborne=n.airborne,fl.phase=X.phase,fl.lap=`${Math.min(i.lap+1,X.config.totalLaps)}/${X.config.totalLaps}`,fl.sector=i.sector,fl.lapValid=i.lapValid,fl.bestLap=Ya(i.bestLap),fl.record=Ya(Gc.best);let a=q.held(W);ml.held=a?`${xo[a].name} (${a})`:`—`;let o=q.effectsOf(W).list();ml.effects=o.length===0?`—`:o.map(e=>`${e.type} ${e.duration.toFixed(1)}s`).join(` · `),ml.entities=`${q.projectiles.length} / ${q.traps.length}`;let s=To(X.getStanding(W)?.place??1,X.racerCount);ml.chances=So.filter(e=>s[e]>0).map(e=>`${e.slice(0,4)} ${(s[e]*100).toFixed(0)}%`).join(` · `);let c=X.standings.find(e=>!e.isPlayer);pl.leaderSpeedMul=Vl((c?K.find(e=>e.id===c.id):void 0)?.effectiveSpeedMul??1,3),pl.gapToPlayer=Vl(i.totalProgress-(c?X.getProgress(c.id)?.totalProgress??0:0),3),hc.render(t),Q.drawCalls=z.info.render.calls,Q.triangles=z.info.render.triangles,Q.pixelRatio=Vl(z.getPixelRatio(),2),Q.fps=Math.round(yl.averageFps),Q.particles=`${Nc.activeCount} / ${Pc?.activeCount??0} / ${J.activeCount}`,Q.autoAdapt&&yl.push(t)&&_l(),Yl()}})}var Jl=!1;function Yl(){if(Jl||yl.averageFps===0)return;Jl=!0;let e=Ni(z,N);for(let t of e)console.warn(`[perf] ${t}`)}window.addEventListener(`resize`,()=>{z.setPixelRatio(nt(P,window.devicePixelRatio)),z.setSize(window.innerWidth,window.innerHeight),hc.setSize(window.innerWidth,window.innerHeight),H.resize(window.innerWidth/window.innerHeight),Uc()}),hl(N),lc.complete(`scene`),await uc();var Xl=new Gi(z,{tier:N});await Xl.loadPhase(`core`,e=>lc.set(`assets`,e)),await uc();var{PhysicsSystem:Zl}=await mi(async()=>{let{PhysicsSystem:e}=await import(`./PhysicsSystem-B0fLkISM.js`);return{PhysicsSystem:e}},__vite__mapDeps([4,1,5]),import.meta.url),Ql=await Zl.create(B,fc.collision,dc);lc.complete(`physics`),hc.render(),await uc(),cc.hide(),Sl=ql(Ql),Cl=!0,tc.start(),Q.audioFallback=I.syntheticCount>0?`${I.syntheticCount} 条用合成音`:`无（全部用真文件）`,I.syntheticCount>0&&console.info(`[audio] ${I.syntheticCount} 条音效没找到文件，用的是程序化占位音。把真文件放进 public/audio/（路径见 src/audio/SoundDefs.ts）就会自动换过去。`),F===`touch`&&xl.isPortrait||Sl.start(),Xl.loadPhase(`deferred`),V.sky.loadHdri(`./`+Qi,V.scene).then(e=>{e&&V.setQuality(P)});var $l=new qi;$l.load(Zi).then(e=>{if(e){for(let e of jc){let t=$l.instantiate(Zi);t&&e.setModel(t)}console.info(`[models] 卡丁车模型已换上（${jc.length} 辆）`)}});