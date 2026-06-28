/**
 * 扩展宿主与 Webview 之间共享的数据结构。
 * 这两个进程各自打包，但通过这套契约通信。
 */

/** 单个采样点（笔尖坐标 + 压力，压力用于稍后做笔锋，默认 0.5）。 */
export interface InkPoint {
  x: number;
  y: number;
  p: number;
}

/** 一笔：颜色 + 线宽 + 点序列。 */
export interface InkStroke {
  color: string;
  width: number;
  /** 高亮笔：半透明粗线，叠在文字上方而不遮挡。 */
  highlight?: boolean;
  points: InkPoint[];
}

/** 持久化到磁盘的墨迹文档。 */
export interface InkDocument {
  version: number;
  /** 对应源 Markdown 的 URI（便于追溯）。 */
  sourceUri: string;
  /** 打开快照时源文件的 mtime，用于检测“源文件已变更、墨迹可能错位”。 */
  sourceMtime: number;
  /** viewport 宽度参考，用于在新窗口宽度变化时缩放墨迹。 */
  viewportWidth: number;
  strokes: InkStroke[];
}

/** Webview → Extension 的消息。 */
export type ToExtensionMessage =
  | { type: 'ready' }
  | { type: 'save'; ink: InkDocument }
  | { type: 'request-refresh' }
  | { type: 'open-link'; href: string };

/** Extension → Webview 的消息。 */
export type ToWebviewMessage =
  | { type: 'init'; md: string; ink: InkDocument | null; sourceUri: string }
  | { type: 'refresh'; md: string };
