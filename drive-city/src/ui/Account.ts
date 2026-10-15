import type { Engine } from '../core/Engine';
import { lang, onLangChange, t, type TKey } from '../core/I18n';
import type { CloudApi } from '../online/Cloud';
import type { Summary } from '../online/CloudSave';
import { C, F, css, el } from './theme';
import { formatPlaytime, readPlaytime } from './PlayTime';

css(`
.acct{position:fixed;inset:0;z-index:31;display:grid;place-items:center;background:rgba(9,11,13,.62);font-family:${F.ui};color:${C.paper};padding:16px;box-sizing:border-box}
.acct[hidden]{display:none}
.acct .box{width:min(420px,100%);max-height:100%;overflow:auto;box-sizing:border-box;padding:18px 20px 16px;border-radius:12px;background:#15191c;border:1px solid ${C.line};box-shadow:0 18px 60px rgba(0,0,0,.5)}
.acct .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.acct h2{margin:0;font:800 13px/1 ${F.num};letter-spacing:.24em;color:${C.yellow}}
.acct button{font:inherit;cursor:pointer;border:0;border-radius:6px;color:inherit}
.acct .x{background:transparent;color:${C.muted};font-size:22px;line-height:1;padding:2px 8px}
.acct .tabs{display:flex;gap:6px;margin-bottom:14px}
.acct .tabs button{flex:1;padding:9px 10px;background:rgba(244,241,232,.07);color:${C.muted};font:800 14px/1 ${F.ui}}
.acct .tabs button.on{background:${C.yellow};color:${C.ink}}
.acct label{display:block;font:600 12px/1 ${F.ui};color:${C.muted};margin:10px 0 6px}
.acct input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:7px;border:1px solid ${C.line};background:rgba(244,241,232,.06);color:${C.paper};font:600 15px/1.2 ${F.ui}}
.acct input:focus{outline:2px solid ${C.yellow};outline-offset:-1px}
.acct .go{width:100%;margin-top:16px;padding:12px;background:${C.yellow};color:${C.ink};font:800 15px/1 ${F.ui};letter-spacing:.1em}
.acct .go:disabled{opacity:.5;cursor:default}
.acct .alt{width:100%;margin-top:8px;padding:11px;background:rgba(244,241,232,.1);font:800 14px/1 ${F.ui};letter-spacing:.06em}
.acct .link{display:block;margin:12px auto 0;background:transparent;color:${C.muted};font:600 13px/1 ${F.ui};text-decoration:underline}
.acct .err{min-height:18px;margin-top:10px;font:600 13px/1.4 ${F.ui};color:#ff7a6a}
.acct .note{margin-top:12px;font:500 12px/1.6 ${F.ui};color:${C.muted}}
.acct .code{margin:14px 0 6px;padding:14px;border-radius:8px;background:rgba(243,181,15,.12);border:1px dashed ${C.yellow};text-align:center;font:800 24px/1 ${F.mono};letter-spacing:.12em;color:${C.yellow};user-select:all}
.acct .me{font:800 20px/1.2 ${F.ui};margin-bottom:6px}
.acct .st{font:600 13px/1.5 ${F.ui};color:${C.muted}}
.acct .st.ok{color:#62d39a}.acct .st.bad{color:#ff7a6a}
.acct .pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.acct .side{padding:12px;border-radius:8px;background:rgba(244,241,232,.05);border:1px solid ${C.line}}
.acct .side h3{margin:0 0 8px;font:800 13px/1 ${F.ui};color:${C.yellow}}
.acct .side div{font:600 13px/1.7 ${F.ui}}
.acct .side .when{color:${C.muted};font-size:12px}
`);

/** A time in the game's language (the browser's own locale may be another). */
const when = (ms: number) => new Date(ms).toLocaleString(lang() === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

type View = 'login' | 'register' | 'reset' | 'recovery' | 'me' | 'conflict';
const ERR: Record<string, TKey> = { name: 'acct.err.name', pw: 'acct.err.pw', taken: 'acct.err.taken', wrong: 'acct.err.wrong', busy: 'acct.err.busy', network: 'acct.err.network', mismatch: 'acct.err.mismatch', wrongCode: 'acct.err.wrongCode' };

/**
 * The account panel (2026-10-15; the title's and pause screen's 登录 / 注册 button): log in, register (then the
 * recovery code, once, to keep), reset a forgotten password with that code, and once logged in the sync's state, a
 * sync-now and log-out. A conflict between this device's save and the cloud's opens it by itself: the two side by
 * side, keep one.
 */
export class AccountPanel {
  readonly root: HTMLDivElement;
  private box: HTMLDivElement;
  private view: View = 'login';
  private code = '';
  private busy = false;
  private error = '';
  /** What was typed, kept across redraws (an error redraws the form); cleared when the panel closes or it worked. */
  private vals = new Map<string, string>();
  /** What the last 立即同步 did, shown under the status. */
  private result = '';

  constructor(private engine: Engine, container: HTMLElement, private onUser: () => void) {
    const root = this.root = el('div', 'acct', container);
    root.hidden = true;
    root.addEventListener('click', (e) => { if (e.target === root && this.view !== 'conflict' && this.view !== 'recovery') this.hide(); });
    // typing must not drive the car or pause the game (Input listens on window)
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.view !== 'conflict' && this.view !== 'recovery') this.hide(); e.stopPropagation(); });
    root.addEventListener('keyup', (e) => e.stopPropagation());
    this.box = el('div', 'box', root);
    onLangChange(() => { if (!root.hidden) this.build(); });
    const c = this.api();
    if (c) c.onChange = () => {
      this.onUser();
      if (c.conflict && (this.root.hidden || this.view !== 'conflict')) { this.view = 'conflict'; this.root.hidden = false; }
      if (!this.root.hidden) this.build();
    };
    if (c?.conflict) queueMicrotask(() => c.onChange?.());
  }

  private api() { return this.engine.get<CloudApi>('cloud'); }

  show(): void {
    const c = this.api();
    this.error = '';
    this.view = c?.conflict ? 'conflict' : c?.user ? 'me' : 'login';
    this.root.hidden = false;
    this.build();
  }
  hide(): void { this.root.hidden = true; this.vals.clear(); this.result = ''; }
  get open(): boolean { return !this.root.hidden; }

  private build(): void {
    const c = this.api(), b = this.box;
    b.textContent = '';
    if (!c) return;
    const top = el('div', 'top', b);
    el('h2', '', top).textContent = t(this.view === 'conflict' ? 'acct.conflict' : this.view === 'recovery' ? 'acct.recoveryTitle' : 'acct.title');
    if (this.view !== 'conflict' && this.view !== 'recovery') { const x = el('button', 'x', top); x.textContent = '×'; x.addEventListener('click', () => this.hide()); }
    if (this.view === 'login' || this.view === 'register') this.form(b, c);
    else if (this.view === 'reset') this.resetForm(b, c);
    else if (this.view === 'recovery') this.recovery(b);
    else if (this.view === 'me') this.me(b, c);
    else this.conflict(b, c);
  }

  private field(b: HTMLElement, label: TKey, type: string, auto: AutoFill): HTMLInputElement {
    el('label', '', b).textContent = t(label);
    const i = el('input', '', b);
    i.type = type; i.autocomplete = auto; i.spellcheck = false; i.autocapitalize = 'off';
    i.value = this.vals.get(label) ?? '';
    i.addEventListener('input', () => this.vals.set(label, i.value));
    return i;
  }
  private fail(err: string): void {
    this.error = t(ERR[err] ?? 'acct.err.server'); this.busy = false;
    // a wrong password is typed again; the name stays
    if (err === 'wrong' || err === 'wrongCode' || err === 'mismatch') for (const k of ['acct.pw', 'acct.pw2', 'acct.code']) this.vals.delete(k);
    this.build();
  }

  private form(b: HTMLElement, c: CloudApi): void {
    const tabs = el('div', 'tabs', b);
    for (const v of ['login', 'register'] as const) {
      const bt = el('button', v === this.view ? 'on' : '', tabs);
      bt.textContent = t(v === 'login' ? 'acct.login' : 'acct.register');
      bt.addEventListener('click', () => { this.view = v; this.error = ''; this.build(); });
    }
    const reg = this.view === 'register';
    const name = this.field(b, 'acct.name', 'text', 'username');
    const pw = this.field(b, 'acct.pw', 'password', reg ? 'new-password' : 'current-password');
    const pw2 = reg ? this.field(b, 'acct.pw2', 'password', 'new-password') : null;
    const go = el('button', 'go', b);
    go.textContent = t(this.busy ? 'acct.wait' : reg ? 'acct.register' : 'acct.login');
    go.disabled = this.busy;
    const submit = async () => {
      if (this.busy) return;
      if (pw2 && pw.value !== pw2.value) { this.fail('mismatch'); return; }
      this.busy = true; this.error = ''; go.disabled = true; go.textContent = t('acct.wait');
      if (reg) {
        const r = await c.register(name.value.trim(), pw.value);
        if (!r.ok) { this.fail(r.error); return; }
        this.busy = false; this.code = r.recovery; this.view = 'recovery'; this.vals.clear();
      } else {
        const r = await c.login(name.value.trim(), pw.value);
        if (!r.ok) { this.fail(r.error); return; }
        this.busy = false; this.view = c.conflict ? 'conflict' : 'me'; this.vals.clear();
      }
      this.build();
    };
    go.addEventListener('click', () => { void submit(); });
    for (const i of [name, pw, pw2]) i?.addEventListener('keydown', (e) => { if (e.key === 'Enter') void submit(); });
    el('div', 'err', b).textContent = this.error;
    if (!reg) { const l = el('button', 'link', b); l.textContent = t('acct.forgot'); l.addEventListener('click', () => { this.view = 'reset'; this.error = ''; this.build(); }); }
    el('div', 'note', b).textContent = t(reg ? 'acct.noteReg' : 'acct.note');
    if (!c.enabled) { this.error = t('acct.err.off'); go.disabled = true; }
    queueMicrotask(() => name.focus());
  }

  private resetForm(b: HTMLElement, c: CloudApi): void {
    el('div', 'note', b).textContent = t('acct.resetNote');
    const name = this.field(b, 'acct.name', 'text', 'username');
    const rc = this.field(b, 'acct.code', 'text', 'off');
    const pw = this.field(b, 'acct.newPw', 'password', 'new-password');
    const go = el('button', 'go', b);
    go.textContent = t(this.busy ? 'acct.wait' : 'acct.reset');
    go.disabled = this.busy;
    go.addEventListener('click', async () => {
      if (this.busy) return;
      this.busy = true; go.disabled = true; go.textContent = t('acct.wait');
      const r = await c.reset(name.value.trim(), rc.value, pw.value);
      if (!r.ok) { this.fail(r.error === 'wrong' ? 'wrongCode' : r.error); return; }
      this.busy = false; this.code = r.recovery; this.view = 'recovery'; this.vals.clear(); this.build();
    });
    el('div', 'err', b).textContent = this.error;
    const back = el('button', 'link', b); back.textContent = t('acct.back'); back.addEventListener('click', () => { this.view = 'login'; this.error = ''; this.build(); });
  }

  private recovery(b: HTMLElement): void {
    el('div', 'st', b).textContent = t('acct.recoveryNote');
    el('div', 'code', b).textContent = this.code;
    const ok = el('button', 'go', b); ok.textContent = t('acct.saved');
    ok.addEventListener('click', () => {
      this.code = '';
      const c = this.api();
      if (c?.conflict) { this.view = 'conflict'; this.build(); return; }
      // done: back to the game, a word that it is in hand
      this.hide();
      this.engine.get<{ name: string; toast(s: string): void }>('hud')?.toast(t('acct.welcome', { name: c?.user ?? '' }));
    });
  }

  private me(b: HTMLElement, c: CloudApi): void {
    el('div', 'me', b).textContent = c.user ?? '';
    el('div', 'st', b).textContent = t('pause.playtime', { time: formatPlaytime(readPlaytime()) });
    const s = c.status, at = c.lastSync ? when(c.lastSync) : '';
    const st = el('div', `st ${s === 'ok' ? 'ok' : s === 'offline' ? 'bad' : ''}`, b);
    st.textContent = s === 'syncing' || this.busy ? t('acct.syncing') : s === 'offline' ? t('acct.offline') : at ? t('acct.synced', { when: at }) : t('acct.notYet');
    // what the last 立即同步 did (it always talks to the server: a click that changes nothing still says so)
    if (this.result && !this.busy) el('div', 'st ok', b).textContent = this.result;
    const back = el('button', 'go', b); back.textContent = t('acct.back2game');
    back.addEventListener('click', () => this.hide());
    const sync = el('button', 'alt', b); sync.textContent = t(this.busy ? 'acct.syncing' : 'acct.syncNow'); sync.disabled = s === 'syncing' || this.busy;
    sync.addEventListener('click', async () => {
      this.busy = true; this.result = ''; this.build();
      const r = await c.syncNow();
      this.busy = false;
      this.result = r === 'pushed' ? t('acct.didPush') : r === 'same' ? t('acct.didSame') : r === 'offline' ? '' : '';
      this.build();
    });
    const out = el('button', 'alt', b); out.textContent = t('acct.logout');
    out.addEventListener('click', async () => { await c.logout(); this.view = 'login'; this.build(); });
    el('div', 'note', b).textContent = t('acct.meNote');
  }

  private conflict(b: HTMLElement, c: CloudApi): void {
    const k = c.conflict;
    if (!k) { this.view = c.user ? 'me' : 'login'; this.build(); return; }
    el('div', 'st', b).textContent = t('acct.conflictNote');
    const pair = el('div', 'pair', b);
    const side = (title: TKey, s: Summary, when: string) => {
      const d = el('div', 'side', pair);
      el('h3', '', d).textContent = t(title);
      el('div', '', d).textContent = t('acct.chapters', { n: s.chapters });
      el('div', '', d).textContent = `¥${s.cash.toLocaleString()}`;
      el('div', '', d).textContent = t(s.car ? 'acct.car' : 'acct.noCar');
      el('div', '', d).textContent = t('pause.playtime', { time: formatPlaytime(s.secs) });
      if (when) el('div', 'when', d).textContent = when;
    };
    side('acct.local', k.local, '');
    side('acct.cloud', k.cloud, k.cloudTs ? t('acct.savedAt', { when: when(k.cloudTs) }) : '');
    const keepCloud = el('button', 'go', b); keepCloud.textContent = t('acct.keepCloud');
    keepCloud.addEventListener('click', () => k.resolve('cloud'));
    const keepLocal = el('button', 'alt', b); keepLocal.textContent = t('acct.keepLocal');
    keepLocal.addEventListener('click', () => { k.resolve('local'); this.view = 'me'; this.build(); });
  }
}
