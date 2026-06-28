/* ScribbleMD Webview 主脚本。
 * 负责：Markdown 渲染（冻结快照）+ 透明手写 Canvas + 工具栏交互 + 持久化通信。
 */
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import cssText from './styles.css';
import {
  InkDocument,
  InkPoint,
  InkStroke,
  ToExtensionMessage,
  ToWebviewMessage,
} from '../src/inkTypes';

declare function acquireVsCodeApi(): {
  postMessage(msg: ToExtensionMessage): void;
};

const vscode = acquireVsCodeApi();

// 样式随脚本一同注入，避免外部 <link> 在某些环境下加载失败导致 Canvas 定位失效。
const styleEl = document.createElement('style');
styleEl.textContent = cssText;
document.head.appendChild(styleEl);

/* ------------------------------- 图标 ------------------------------- */
// Lucide 风格 SVG（MIT），内联避免外部字体依赖。
const svg = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const ICONS: Record<string, string> = {
  pen: svg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  highlighter: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  eraser: svg('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
  hand: svg('<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
  pipette: svg('<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'),
  eye: svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  'eye-off': svg('<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>'),
  refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>'),
  list: svg('<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>'),
  'panel-left': svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>'),
};

function paintIcons(): void {
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const name = el.dataset.icon;
    if (name && ICONS[name]) {
      el.innerHTML = ICONS[name];
    }
  });
}

/* ------------------------------- 状态 ------------------------------- */

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang }).value}</code></pre>`;
      } catch {
        /* fallback */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

let strokes: InkStroke[] = [];
let redoStack: InkStroke[] = [];
let current: InkStroke | null = null;

type Tool = 'pen' | 'highlighter' | 'eraser' | 'hand';
let tool: Tool = 'pen';
let color = '#e74c3c';
let width = 2.5;
let mdVisible = true;

/* ------------------------------- DOM ------------------------------- */

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector(s) as T;
const markdownEl = $('#markdown')!;
const canvas = $('#ink-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const contentEl = $('#content')!;
const hintEl = $('#hint')!;
const widthInput = $('#width') as HTMLInputElement;
const widthVal = $('#width-val')!;
const colorBtn = $('#color-btn')!;
const colorPop = $('#color-pop')!;
const colorInput = $('#color-input') as HTMLInputElement;
const colorDot = $('#color-dot')!;
const presetsEl = $('#presets')!;
const cursorEl = $('#cursor')!;
const toolbarEl = $('#toolbar')!;
const scrollEl = $('#scroll')!;
const outlineEl = $('#outline')!;
const outlineNav = $('#outline-nav')!;
const outlineToggleBtn = $('#outline-toggle')!;

/* --------------------------- Markdown 渲染 --------------------------- */

function renderMarkdown(text: string): void {
  markdownEl.innerHTML = md.render(text);
  // 链接点击：交给扩展端打开（webview 内无法直接导航）。
  // 相对路径文件链接 → 在 VSCode 中打开新标签页；http/https → 外部浏览器。
  markdownEl.querySelectorAll('a[href]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (a as HTMLAnchorElement).getAttribute('href') || '';
      if (href) {
        vscode.postMessage({ type: 'open-link', href });
      }
    });
  });
  // 图片加载完成后内容高度变化，需要重排 canvas。
  markdownEl.querySelectorAll('img').forEach((img) => {
    img.addEventListener('load', resizeCanvas);
  });
  buildOutline();
  resizeCanvas();
}

/* ----------------------------- 大纲生成 ----------------------------- */

/** 转义标题文本用于生成 id（只保留字母数字和中文，其余替换为 -）。 */
function slugify(s: string): string {
  return s.replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/** 解析 markdown 中所有标题，生成大纲导航。点击跳转到对应标题。 */
function buildOutline(): void {
  const heads = markdownEl.querySelectorAll<HTMLHeadingElement>(
    'h1, h2, h3, h4, h5, h6',
  );
  // 清空旧大纲。
  outlineNav.innerHTML = '';
  if (heads.length === 0) {
    outlineEl.classList.add('is-collapsed');
    outlineToggleBtn.classList.remove('is-active');
    return;
  }
  // 自动展开（如果之前不是手动收起的状态）。
  if (!outlineManuallyCollapsed) {
    outlineEl.classList.remove('is-collapsed');
    outlineToggleBtn.classList.add('is-active');
  }
  heads.forEach((h, i) => {
    const level = Number(h.tagName[1]);
    if (!h.id) {
      h.id = `h-${i}-${slugify(h.textContent || '')}`;
    }
    const item = document.createElement('button');
    item.className = `outline-item level-${level}`;
    item.textContent = h.textContent || '(无标题)';
    item.title = h.textContent || '';
    item.addEventListener('click', () => {
      // 平滑滚动到标题位置（减去一点顶部偏移，避免标题贴顶）。
      const targetTop = h.offsetTop - 12;
      scrollEl.scrollTo({ top: targetTop, behavior: 'smooth' });
    });
    outlineNav.appendChild(item);
  });
}

let outlineManuallyCollapsed = false;
outlineToggleBtn.addEventListener('click', () => {
  outlineManuallyCollapsed = !outlineManuallyCollapsed;
  outlineEl.classList.toggle('is-collapsed', outlineManuallyCollapsed);
  outlineToggleBtn.classList.toggle('is-active', !outlineManuallyCollapsed);
  // 大纲是浮层，不改变 #content 宽度，笔迹不会错位，无需 resizeCanvas。
});

/* --------------------------- Canvas 尺寸 ---------------------------- */

// 浏览器对 canvas 像素尺寸有上限（Chrome 约 16384 单边 / 268M 总像素），
// 长文档会触发上限导致画布变白甚至 webview 崩溃。
// 解决：canvas 只占视口高度，滚动时通过坐标平移重绘对应区域的墨迹。
const MAX_CANVAS_DIM = 8192;

// canvas 顶部对应的文档 Y（用于坐标转换）。由 redraw 在滚动时更新。
let canvasTopY = 0;

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = contentEl.getBoundingClientRect();
  // canvas 高度取 2 倍视口高度，上下各留半屏余量，
  // 滚动时边缘笔画不会被立即裁掉，避免"上面被吞"的视觉问题。
  const baseHeight = scrollEl.clientHeight || rect.height;
  const viewportHeight = Math.min(baseHeight * 2, MAX_CANVAS_DIM / dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${viewportHeight}px`;
  canvas.width = Math.min(Math.round(rect.width * dpr), MAX_CANVAS_DIM);
  canvas.height = Math.min(Math.round(viewportHeight * dpr), MAX_CANVAS_DIM);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}

/* ------------------------------ 绘制 ------------------------------ */

function styleStroke(s: InkStroke): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.width;
  if (s.highlight) {
    // 不用 multiply：multiply 会在 lineCap round 的相邻段头尾半圆叠加处越画越深，
    // 出现"重合的圆坨"。改成 source-over + 低 alpha，同色覆盖不会再加深，
    // 水彩的半透明感还在，自相交处颜色保持稳定。
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = s.color;
  } else {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = s.color;
  }
}

function drawStroke(s: InkStroke, offsetY: number): void {
  if (s.points.length === 0) return;
  styleStroke(s);
  ctx.beginPath();
  const p0 = s.points[0];
  ctx.moveTo(p0.x, p0.y - offsetY);
  if (s.points.length === 1) {
    // 单点 → 画一个小圆点
    ctx.lineTo(p0.x + 0.01, p0.y - offsetY + 0.01);
  } else {
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y - offsetY);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** 笔画是否与当前视口区域相交（含 margin 容差）。 */
function strokeInView(s: InkStroke, top: number, bottom: number): boolean {
  const margin = Math.max(20, s.width);
  return s.points.some(
    (p) => p.y >= top - margin && p.y <= bottom + margin,
  );
}

function redraw(): void {
  const scrollTop = scrollEl.scrollTop;
  const viewportH = scrollEl.clientHeight;
  // canvas 顶部往上偏移半屏（留余量），但不超过文档顶部。
  // 这样滚动时上方边缘的笔画仍落在 canvas 内，不会被裁掉。
  canvasTopY = Math.max(0, scrollTop - viewportH / 2);
  canvas.style.transform = `translateY(${canvasTopY}px)`;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 视口范围（用于过滤要画的笔画）。
  const viewportTop = scrollTop;
  const viewportBottom = scrollTop + viewportH;
  const visible = (s: InkStroke) => strokeInView(s, viewportTop, viewportBottom);
  strokes.filter((s) => s.highlight && visible(s)).forEach((s) => drawStroke(s, canvasTopY));
  strokes.filter((s) => !s.highlight && visible(s)).forEach((s) => drawStroke(s, canvasTopY));
}

/* --------------------------- 坐标 & 输入 --------------------------- */

function toLocal(e: PointerEvent): InkPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    // canvas 顶部对应的文档 Y 是 canvasTopY（不是 scrollTop，因为 canvas 顶部往上偏移了半屏）。
    // clientY - rect.top 是 canvas 内 Y，加 canvasTopY 得到文档绝对 Y。
    y: e.clientY - rect.top + canvasTopY,
    p: e.pressure > 0 ? e.pressure : 0.5,
  };
}

function eraserRadius(): number {
  return Math.max(8, width * 3);
}

function eraseAt(x: number, y: number): boolean {
  const r = eraserRadius();
  let changed = false;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const hit = strokes[i].points.some(
      (p) => (p.x - x) ** 2 + (p.y - y) ** 2 < r * r,
    );
    if (hit) {
      strokes.splice(i, 1);
      changed = true;
    }
  }
  if (changed) {
    redraw();
    scheduleSave();
  }
  return changed;
}

canvas.addEventListener('pointerdown', (e) => {
  if (tool === 'hand') return;
  canvas.setPointerCapture(e.pointerId);
  const p = toLocal(e);

  if (tool === 'eraser') {
    eraseAt(p.x, p.y);
    return;
  }

  const isHighlight = tool === 'highlighter';
  current = {
    color,
    width: isHighlight ? Math.max(width, 8) * 2 : width,
    highlight: isHighlight,
    points: [p],
  };
  strokes.push(current);
  redoStack = []; // 新笔画后清空重做栈
  drawStroke(current, canvasTopY);
});

canvas.addEventListener('pointermove', (e) => {
  if (tool === 'hand') return;
  if (!current) {
    if (tool === 'eraser' && e.buttons > 0) {
      const p = toLocal(e);
      eraseAt(p.x, p.y);
    }
    return;
  }
  const p = toLocal(e);
  current.points.push(p);
  // 整条重画：让 current 作为一条完整 path 一次 stroke 完成，
  // lineCap round 只在首尾各一次，中间折点用 lineJoin round 衔接，
  // 避免逐段独立 stroke 时相邻端点半圆 cap 叠加导致颜色越画越深。
  redraw();
});

function endStroke(e?: PointerEvent): void {
  if (current) {
    current = null;
    scheduleSave();
  }
  if (e && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
}

canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', (e) => {
  // 离开 canvas 时若仍在按住，继续捕获（setPointerCapture 已处理），这里不结束。
  if (e.buttons === 0) endStroke(e);
});

// 阻止触摸滚动/缩放手势干扰绘制。
canvas.addEventListener('touchstart', (e) => e.preventDefault(), {
  passive: false,
});
canvas.addEventListener('touchmove', (e) => e.preventDefault(), {
  passive: false,
});

/* ----------------------------- 工具栏 ----------------------------- */

function setActiveTool(next: Tool): void {
  tool = next;
  document.body.dataset.mode = next;
  document
    .querySelectorAll<HTMLButtonElement>('.tool')
    .forEach((b) => b.classList.toggle('is-active', b.dataset.tool === next));
  // hand 模式下让事件穿透到滚动容器；其他模式让 canvas 接管。
  canvas.style.pointerEvents = tool === 'hand' ? 'none' : 'auto';
  updateCursor();
}

/* --------------------------- 鼠标预览光标 --------------------------- */
// 一个跟随鼠标的 div：钢笔=小方块、高亮笔=大半透明圆、橡皮=白色方块。
// 颜色和大小都跟当前 tool/width/color 走，让用户一眼知道现在是什么状态。
function updateCursor(): void {
  if (tool === 'hand') {
    cursorEl.style.display = 'none';
    canvas.style.cursor = 'grab';
    return;
  }
  cursorEl.style.display = '';
  canvas.style.cursor = 'none';

  let size = 4;
  let bg = color;
  let round = false;
  let alpha = 1;
  let border = '1px solid rgba(0,0,0,0.35)';

  if (tool === 'pen') {
    size = Math.max(4, width);
    bg = color;
  } else if (tool === 'highlighter') {
    size = Math.max(width, 8) * 2;
    bg = color;
    round = true;
    alpha = 0.5;
  } else {
    // eraser
    size = eraserRadius() * 2;
    bg = '#ffffff';
  }

  cursorEl.style.width = `${size}px`;
  cursorEl.style.height = `${size}px`;
  cursorEl.style.background = bg;
  cursorEl.style.opacity = String(alpha);
  cursorEl.style.borderRadius = round ? '50%' : '2px';
  cursorEl.style.border = border;
}

// 跟随鼠标移动（用 transform 性能好，不触发 layout）。
window.addEventListener('pointermove', (e) => {
  cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
});

// 鼠标进入工具栏时隐藏预览，离开时恢复。
toolbarEl.addEventListener('mouseenter', () => {
  if (tool !== 'hand') cursorEl.style.display = 'none';
});
toolbarEl.addEventListener('mouseleave', () => {
  updateCursor();
});

document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
  b.addEventListener('click', () => setActiveTool(b.dataset.tool as Tool));
});

/* --------------------------- 色盘 / 颜色 --------------------------- */

const PRESETS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#27ae60',
  '#16a085', '#2980d4', '#8e44ad', '#2c3e50',
  '#ffffff', '#bdc3c7',
];

function setColor(c: string): void {
  color = c;
  colorDot.style.background = c;
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    colorInput.value = c;
  }
  // 选颜色后自动回到钢笔，方便继续画。
  if (tool === 'eraser' || tool === 'hand') {
    setActiveTool('pen');
  }
  updateCursor();
}

// 渲染常用预设色块（背景直接内联，避免自定义属性在某些环境下不生效）。
PRESETS.forEach((c) => {
  const b = document.createElement('button');
  b.className = 'preset';
  b.style.background = c;
  b.title = c;
  b.addEventListener('click', () => {
    setColor(c);
    closePopover();
  });
  presetsEl.appendChild(b);
});

colorBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  colorPop.classList.toggle('is-hidden');
});

function closePopover(): void {
  colorPop.classList.add('is-hidden');
}

// 点击色盘外部关闭。
document.addEventListener('click', (e) => {
  if (colorPop.classList.contains('is-hidden')) return;
  if (!colorPop.contains(e.target as Node) && e.target !== colorBtn) {
    closePopover();
  }
});

colorInput.addEventListener('input', () => setColor(colorInput.value));

// 初始颜色显示。
setColor(color);

widthInput.addEventListener('input', () => {
  width = parseFloat(widthInput.value);
  widthVal.textContent = width.toFixed(1);
  updateCursor();
});

$('#undo').addEventListener('click', () => {
  if (strokes.length === 0) return;
  redoStack.push(strokes.pop()!);
  redraw();
  scheduleSave();
});

$('#redo').addEventListener('click', () => {
  if (redoStack.length === 0) return;
  strokes.push(redoStack.pop()!);
  redraw();
  scheduleSave();
});

$('#clear').addEventListener('click', () => {
  if (strokes.length === 0) return;
  strokes = [];
  redoStack = [];
  redraw();
  scheduleSave();
});

const toggleMdBtn = $('#toggle-md');
toggleMdBtn.addEventListener('click', () => {
  mdVisible = !mdVisible;
  markdownEl.style.visibility = mdVisible ? '' : 'hidden';
  toggleMdBtn.classList.toggle('is-active', mdVisible);
  const iconEl = toggleMdBtn.querySelector<HTMLElement>('[data-icon]')!;
  const name = mdVisible ? 'eye' : 'eye-off';
  iconEl.dataset.icon = name;
  iconEl.innerHTML = ICONS[name];
});

$('#refresh').addEventListener('click', () => {
  vscode.postMessage({ type: 'request-refresh' });
});

/* --------------------------- 键盘快捷键 --------------------------- */

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      $('#undo').dispatchEvent(new Event('click'));
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      $('#redo').dispatchEvent(new Event('click'));
    }
    return;
  }
  switch (e.key.toLowerCase()) {
    case 'p':
      setActiveTool('pen');
      break;
    case 'h':
      setActiveTool('highlighter');
      break;
    case 'e':
      setActiveTool('eraser');
      break;
    case 'g':
      setActiveTool('hand');
      break;
  }
});

/* ----------------------------- 持久化 ----------------------------- */

let saveTimer: number | null = null;
function scheduleSave(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    const doc: InkDocument = {
      version: 1,
      sourceUri: '',
      sourceMtime: 0,
      viewportWidth: contentEl.getBoundingClientRect().width,
      strokes,
    };
    vscode.postMessage({ type: 'save', ink: doc });
    saveTimer = null;
  }, 350);
}

/* --------------------------- 消息接收 --------------------------- */

window.addEventListener('message', (e) => {
  const msg = e.data as ToWebviewMessage;
  if (msg.type === 'init') {
    renderMarkdown(msg.md);
    strokes = msg.ink ? msg.ink.strokes.slice() : [];
    redraw();
    hintEl.classList.add('is-hidden');
  } else if (msg.type === 'refresh') {
    renderMarkdown(msg.md);
    // 正文重排后墨迹仍按原坐标保留（可能错位，由用户决定是否清空）。
    redraw();
  }
});

/* --------------------------- 启动收尾 --------------------------- */

// 把所有 [data-icon] 占位填充为 SVG（按钮里的 <i> 此时已在 DOM 中）。
paintIcons();

// 窗口缩放与正文尺寸变化时重排 canvas。
window.addEventListener('resize', resizeCanvas);
const ro = new ResizeObserver(() => resizeCanvas());
ro.observe(contentEl);
ro.observe(markdownEl);

// 滚动时重绘墨迹（视口平移，让笔画跟随对应内容）。
scrollEl.addEventListener('scroll', redraw);

// 初始一次（即便没有消息也把 canvas 准备好）。
resizeCanvas();

// 告诉扩展：webview 已就绪。
vscode.postMessage({ type: 'ready' });
