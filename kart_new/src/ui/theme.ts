/**
 * UI 的设计令牌 + 几个共用的类。
 *
 * 所有界面（HUD、道具槽、比赛面板、主菜单、设置、加载页）都从这里取颜色、
 * 圆角、阴影和字体，**任何地方不许再硬编码一个 #4d9bff 或者 border-radius: 12px**。
 * 这和 QualityTiers 是同一个道理：想统一风格就改一处，而不是去八个文件里翻。
 *
 * ## 为什么是描边字而不是投影字
 * 赛道是明亮的浅色（天蓝 + 草绿 + 白色路肩），纯投影在浅底上几乎看不见，
 * 白字直接糊进背景里。描边（.k-outline）不管底色深浅都能把字抠出来，
 * 而且正好是卡通风格该有的样子。
 *
 * ## 字体
 * 不下载任何字体文件：ui-rounded 在苹果系统上就是 SF Pro Rounded，
 * 其它平台按栈往下退。为一套 UI 拖一个几百 KB 的 webfont 不值 ——
 * 首屏预算总共才 10MB，而且字体是阻塞渲染的。
 */

/** JS 侧要用到的几个颜色（粒子、图表、行内 style），和 CSS 变量保持一致 */
export const THEME = Object.freeze({
  /** 主强调色：按钮、玩家自己的标记 */
  accent: '#2fa8ff',
  /** 最佳成绩 / 高亮数字 */
  gold: '#ffd23f',
  /** 破纪录 / 成功 */
  mint: '#5ef0b4',
  /** 危险 / 中招 */
  danger: '#ff5f6d',
  /** 面板底色（半透明深色） */
  panel: 'rgba(13, 17, 27, 0.78)',
  ink: '#0d111b',
});

let injected = false;

/** 注入一次全局样式。每个 UI 类的构造函数第一行调它，重复调没有副作用 */
export function injectTheme(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = THEME_CSS;
  document.head.appendChild(style);
}

const THEME_CSS = `
  :root {
    --k-accent: ${THEME.accent};
    --k-accent-deep: #1b7fd4;
    --k-gold: ${THEME.gold};
    --k-mint: ${THEME.mint};
    --k-danger: ${THEME.danger};
    --k-ink: ${THEME.ink};
    --k-panel: ${THEME.panel};
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
`;
