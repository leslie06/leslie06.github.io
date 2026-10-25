import type { Engine } from '../core/Engine';
import { lang, onLangChange, t, type TKey } from '../core/I18n';
import type { ChatApi, ChatMsg } from '../online/Chat';
import { C, F, css, el } from './theme';

css(`
/* under the minimap's column (route, best, F1) and the 附近冒险 button (adventure/Panel.ts: +62 px), the same look */
.chat-btn{position:fixed;left:var(--hud-x,38px);top:calc(var(--mm-top,18px) + var(--mm-h,0px) + 114px);z-index:26;pointer-events:auto;display:flex;align-items:center;gap:7px;
  min-height:44px;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid ${C.yellowDim};background:${C.inkGlass};color:${C.paper};font:700 13px/1.2 ${F.ui};cursor:pointer}
.chat-btn b{min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:#ff5a4a;color:#fff;font:800 10px/16px ${F.num};text-align:center}
.chat-btn b[hidden]{display:none}
body.cmp-cine .chat-btn,body.cmp-cine .chat-feed{display:none}
.chat-feed{position:fixed;left:var(--hud-x,38px);top:calc(var(--mm-top,18px) + var(--mm-h,0px) + 166px);z-index:26;width:min(360px,42vw);display:flex;flex-direction:column;gap:3px;pointer-events:none}
.chat-feed .m{padding:4px 9px;border-radius:7px;background:rgba(8,10,12,.55);font:500 13px/1.45 ${F.ui};color:${C.paper};text-shadow:0 1px 3px rgba(0,0,0,.8);
  transition:opacity .6s;word-break:break-word}
.chat-feed .m.old{opacity:0}
.chat-feed .m i,.chat-panel .m i{font-style:normal;font-weight:800;color:#8fc7ff;margin-right:6px}
.chat-feed .m i.g,.chat-panel .m i.g{color:#b9bfcc}
.chat-feed .m i.me,.chat-panel .m i.me{color:${C.yellow}}
.chat-panel{position:fixed;left:var(--hud-x,38px);top:calc(var(--mm-top,18px) + var(--mm-h,0px) + 62px);z-index:29;width:min(380px,calc(100vw - 32px));display:flex;flex-direction:column;border-radius:12px;background:#15191c;
  border:1px solid ${C.line};box-shadow:0 14px 40px rgba(0,0,0,.45);font-family:${F.ui};color:${C.paper};overflow:hidden}
.chat-panel[hidden]{display:none}
body.dc-touch .chat-panel{top:calc(8px + env(safe-area-inset-top,0px))}
/* A phone (2026-10-25, 「聊天键在方向键下面，按动方向键会碰到聊天窗口，把聊天窗口放在方向键上面」): counted down from the radar it
   landed in the ◀ ▶ row on a phone on its side. Now just over the arrows (14 px inset + 84 px keys + 10 px), the new lines beside
   it growing upwards (above it standing up, where the brake is beside it); a smaller key under 320 px tall, clear of the route
   line under the radar. The auto-gas 按住油门 hint (Touch.ts .go, until the first touch) has that place for its few seconds. */
body.dc-touch .chat-btn{top:auto;left:calc(14px + env(safe-area-inset-left,0px));bottom:calc(108px + env(safe-area-inset-bottom,0px))}
body.dc-touch:has(.qq .go:not([hidden])) .chat-btn{visibility:hidden}
body.dc-touch .chat-feed{top:auto;left:calc(140px + env(safe-area-inset-left,0px));bottom:calc(108px + env(safe-area-inset-bottom,0px));width:min(320px,36vw)}
@media (orientation:portrait){body.dc-touch .chat-feed{left:calc(14px + env(safe-area-inset-left,0px));bottom:calc(184px + env(safe-area-inset-bottom,0px));width:min(300px,66vw)}}
@media (max-height:320px){
  body.dc-touch .chat-btn{min-height:34px;padding:6px 10px;bottom:calc(104px + env(safe-area-inset-bottom,0px))}
  body.dc-touch .chat-feed{bottom:calc(104px + env(safe-area-inset-bottom,0px))}
}
.chat-panel .top{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid ${C.line}}
.chat-panel h3{margin:0;font:800 12px/1 ${F.num};letter-spacing:.22em;color:${C.yellow}}
.chat-panel .x{background:transparent;border:0;color:${C.muted};font-size:20px;line-height:1;cursor:pointer;padding:0 4px}
.chat-panel .list{max-height:min(40vh,320px);overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:4px}
.chat-panel .m{font:500 13px/1.5 ${F.ui};word-break:break-word}
.chat-panel .m .ts{color:${C.muted};font-size:11px;margin-left:6px}
.chat-panel .empty{color:${C.muted};font:500 13px/1.6 ${F.ui};padding:6px 0}
.chat-panel .send{display:flex;gap:6px;padding:9px 12px;border-top:1px solid ${C.line}}
.chat-panel input{flex:1;min-width:0;padding:8px 10px;border-radius:7px;border:1px solid ${C.line};background:rgba(244,241,232,.06);color:${C.paper};font:500 14px/1.2 ${F.ui}}
.chat-panel input:focus{outline:2px solid ${C.yellow};outline-offset:-1px}
.chat-panel .go{padding:8px 14px;border:0;border-radius:7px;background:${C.yellow};color:${C.ink};font:800 13px/1 ${F.ui};cursor:pointer}
.chat-panel .go:disabled{opacity:.5;cursor:default}
.chat-panel .err{min-height:0;padding:0 12px 8px;font:600 12px/1.4 ${F.ui};color:#ff7a6a}
.chat-panel .err:empty{display:none}
.chat-panel .who{padding:0 12px 8px;font:500 11px/1.4 ${F.ui};color:${C.muted}}
`);

const ERR: Record<string, TKey> = { fast: 'chat.err.fast', dup: 'chat.err.dup', ad: 'chat.err.ad', empty: 'chat.err.empty', network: 'chat.err.network' };
const FEED = 6, FEED_SECS = 10;

/**
 * The chat on screen (online/Chat.ts): a 聊天 button under the radar with the unread count, the latest messages fading
 * in under it as they arrive (10 s), and the panel - the history, a box to type in, 发送 - opened by the button or Y
 * (on foot or driving, not in a cutscene). Typing never reaches the game (keydown stops at the panel); Esc closes it.
 */
export class ChatPanel {
  private btn: HTMLButtonElement;
  private badge: HTMLElement;
  private feed: HTMLDivElement;
  private panel: HTMLDivElement;
  private list: HTMLDivElement;
  private input: HTMLInputElement;
  private go: HTMLButtonElement;
  private err: HTMLDivElement;
  private who: HTMLDivElement;
  private sending = false;

  constructor(private engine: Engine, hud: HTMLElement, container: HTMLElement, private chat: ChatApi, private playing: () => boolean) {
    this.btn = el('button', 'chat-btn', hud);
    const label = el('span', '', this.btn);
    this.badge = el('b', '', this.btn); this.badge.hidden = true;
    this.btn.addEventListener('click', () => this.toggle());
    this.feed = el('div', 'chat-feed', hud);
    // on the page itself, as the 附近冒险 button is (a child of the game's container stacks under it, whatever its z-index)
    const p = this.panel = el('div', 'chat-panel', document.body);
    p.hidden = true;
    const top = el('div', 'top', p);
    const h = el('h3', '', top);
    const x = el('button', 'x', top); x.textContent = '×'; x.addEventListener('click', () => this.close());
    this.list = el('div', 'list', p);
    const send = el('div', 'send', p);
    this.input = el('input', '', send);
    this.input.maxLength = 120; this.input.enterKeyHint = 'send'; this.input.autocomplete = 'off';
    this.go = el('button', 'go', send);
    this.err = el('div', 'err', p);
    this.who = el('div', 'who', p);
    const labels = () => { label.textContent = `💬 ${t('chat.button')}`; h.textContent = t('chat.title'); this.input.placeholder = t('chat.placeholder'); this.go.textContent = t('chat.send'); this.renderList(); };
    labels(); onLangChange(labels);
    // typing stays in the chat (Input listens on window, bubbling): Enter sends, Esc closes
    p.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void this.send(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    this.go.addEventListener('click', () => { void this.send(); });
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code !== 'KeyY' || !this.panel.hidden || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || !this.playing() || document.body.classList.contains('cmp-cine')) return;
      e.preventDefault(); this.openPanel();
    });
    chat.onMsgs = (fresh, history) => { this.renderList(); if (!history) this.toFeed(fresh); this.renderBadge(); };
  }

  /** Shown only in the game (not on the title or pause screen). */
  setVisible(on: boolean): void { this.btn.style.display = on ? '' : 'none'; this.feed.style.display = on ? '' : 'none'; if (!on) this.close(); }

  private toggle(): void { if (this.panel.hidden) this.openPanel(); else this.close(); }
  private openPanel(): void {
    this.panel.hidden = false;
    this.chat.open = true;
    this.renderBadge(); this.renderList();
    this.feed.style.visibility = 'hidden';
    this.engine.input.exitLock();
    const acct = (() => { try { return (JSON.parse(localStorage.getItem('drivecity.acct.v1') ?? 'null') as { name?: string } | null)?.name ?? null; } catch { return null; } })();
    this.who.textContent = acct ? t('chat.asUser', { name: acct }) : t('chat.asGuest');
    queueMicrotask(() => this.input.focus());
  }
  close(): void {
    if (this.panel.hidden) return;
    this.panel.hidden = true;
    this.chat.open = false;
    this.feed.style.visibility = '';
    this.input.blur();
  }

  private line(parent: HTMLElement, m: ChatMsg, ts: boolean): HTMLElement {
    const d = el('div', 'm', parent);
    const n = el('i', m.mine ? 'me' : m.guest ? 'g' : '', d); n.textContent = m.name;
    d.append(document.createTextNode(m.text));
    if (ts) { const s = el('span', 'ts', d); s.textContent = new Date(m.ts).toLocaleTimeString(lang() === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }); }
    return d;
  }
  private renderList(): void {
    if (this.panel.hidden) return;
    const atEnd = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 30;
    this.list.textContent = '';
    if (!this.chat.msgs.length) el('div', 'empty', this.list).textContent = t('chat.empty');
    for (const m of this.chat.msgs) this.line(this.list, m, true);
    if (atEnd || this.list.scrollTop === 0) this.list.scrollTop = this.list.scrollHeight;
  }
  private renderBadge(): void { const n = this.chat.unread; this.badge.hidden = !n; this.badge.textContent = n > 99 ? '99+' : String(n); }
  /** New messages under the button for a while. */
  private toFeed(fresh: readonly ChatMsg[]): void {
    for (const m of fresh) {
      const d = this.line(this.feed, m, false);
      setTimeout(() => d.classList.add('old'), FEED_SECS * 1000);
      setTimeout(() => d.remove(), FEED_SECS * 1000 + 700);
    }
    while (this.feed.children.length > FEED) this.feed.firstChild?.remove();
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.sending) return;
    this.sending = true; this.go.disabled = true; this.err.textContent = '';
    const r = await this.chat.send(text);
    this.sending = false; this.go.disabled = false;
    if (r.ok) { this.input.value = ''; this.renderList(); this.list.scrollTop = this.list.scrollHeight; return; }
    this.err.textContent = r.error === 'banned' ? t('chat.err.banned', { until: r.until ? new Date(r.until).toLocaleString() : '' }) : t(ERR[r.error] ?? 'chat.err.server');
  }
}
