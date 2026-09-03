/**
 * 起不来的时候给玩家看的那一页。
 *
 * 两种情况：
 *   - **设备不支持**（没有 WebGL2）：这不是 bug，是这台机器就跑不了，
 *     所以话要说清楚 —— "换个浏览器"比"发生了未知错误"有用得多；
 *   - **启动失败**（资源下不来、wasm 编译失败、我们自己的 bug）：
 *     给一句人话 + 一个"复制诊断信息"按钮，玩家把那段贴过来就能排查。
 *
 * 不用 alert：alert 在移动端会挡住整个页面而且没法复制内容。
 */
import { injectTheme } from './theme';

export interface FatalScreenOptions {
  title: string;
  /** 一句人话，说清楚"发生了什么"和"能怎么办" */
  message: string;
  /** 点"复制诊断信息"时取的文本。不给就不显示那个按钮 */
  diagnostics?: () => string;
  /** 显示"重新加载"按钮 */
  canRetry?: boolean;
}

export function showFatalScreen(parent: HTMLElement, options: FatalScreenOptions): void {
  injectTheme();
  injectFatalStyles();

  // 把已有的东西盖掉：这时候画面上可能是半张加载界面或者一片黑
  const root = document.createElement('div');
  root.className = 'fatal';
  root.innerHTML = `
    <div class="fatal-box k-panel">
      <div class="fatal-icon">⚠</div>
      <div class="fatal-title">${escapeHtml(options.title)}</div>
      <div class="fatal-message">${escapeHtml(options.message)}</div>
      <div class="fatal-actions">
        ${options.canRetry ? '<button class="k-btn fatal-retry" type="button">重新加载</button>' : ''}
        ${options.diagnostics ? '<button class="k-btn k-btn-ghost fatal-copy" type="button">复制诊断信息</button>' : ''}
      </div>
      <pre class="fatal-details" hidden></pre>
    </div>
  `;
  parent.appendChild(root);

  root.querySelector('.fatal-retry')?.addEventListener('click', () => location.reload());

  const copy = root.querySelector<HTMLButtonElement>('.fatal-copy');
  const details = root.querySelector<HTMLPreElement>('.fatal-details')!;
  copy?.addEventListener('click', () => {
    const text = options.diagnostics?.() ?? '';
    // 剪贴板 API 在非 https 下不可用（局域网调试就是这种情况），
    // 所以失败时把内容摊在页面上让玩家自己选中复制 —— 总比什么都没有强
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        copy.textContent = '已复制 ✓';
        setTimeout(() => (copy.textContent = '复制诊断信息'), 2000);
      })
      .catch(() => {
        details.textContent = text;
        details.hidden = false;
        copy.textContent = '复制不了，请手动选中下面的文字';
      });
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

let injected = false;
function injectFatalStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
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
  `;
  document.head.appendChild(style);
}
