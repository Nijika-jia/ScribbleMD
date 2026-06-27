import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { InkDocument, ToExtensionMessage, ToWebviewMessage } from './inkTypes';

/**
 * 负责：对一个 Markdown 文件，打开一个独立的 Webview 标签页，
 * 渲染“冻结快照 + 透明手写层”，并把墨迹读写到 `<file>.md.ink.json`。
 */
export class InkEditorProvider implements vscode.Disposable {
  /** key = 源文件 fsPath；同一文件只开一个面板。 */
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** 命令入口：可由编辑器标题按钮 / 资源管理器右键 / 命令面板触发。 */
  async open(uri?: vscode.Uri): Promise<void> {
    const target = await this.resolveTarget(uri);
    if (!target) {
      return;
    }

    // 仅支持磁盘上的文件（未保存的 untitled 文件无法持久化墨迹）。
    if (target.scheme !== 'file') {
      vscode.window.showWarningMessage('ScribbleMD: 暂只支持磁盘上的 Markdown 文件。');
      return;
    }

    const key = target.fsPath;
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Active, false);
      return;
    }

    await this.createPanel(target);
  }

  /** 确定要标注的目标文件。 */
  private async resolveTarget(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (uri) {
      return uri;
    }
    const active = vscode.window.activeTextEditor;
    if (active && active.document.languageId === 'markdown') {
      return active.document.uri;
    }
    // 没有活动 MD 编辑器时，让用户挑一个。
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Markdown: ['md', 'markdown'] },
      openLabel: '选择要标注的 Markdown',
    });
    return files?.[0];
  }

  private async createPanel(uri: vscode.Uri): Promise<void> {
    const fileName = path.basename(uri.fsPath);
    const dir = path.dirname(uri.fsPath);

    const panel = vscode.window.createWebviewPanel(
      'scribblemd.editor',
      `ScribbleMD: ${fileName}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // 允许 webview 加载扩展自身资源（脚本/样式）与源文件所在目录（图片等相对资源）。
        localResourceRoots: [
          this.context.extensionUri,
          vscode.Uri.file(dir),
        ],
      },
    );

    panel.webview.html = this.getHtml(panel.webview);

    // 标签页图标：指向扩展包内的 RiEdit2Fill.png（内嵌铅笔图标）。
    panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      'RiEdit2Fill.png',
    );

    // 初始数据：当前 MD 内容 + 已有墨迹。
    const md = await this.readMarkdown(uri);
    const ink = await this.loadInk(uri);
    this.post(panel, { type: 'init', md, ink, sourceUri: uri.toString() });

    // 状态栏：保存提示。
    const status = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    status.text = '$(check) ScribbleMD: 已保存';
    status.tooltip = '墨迹已持久化';
    status.show();

    panel.webview.onDidReceiveMessage(
      (msg: ToExtensionMessage) => {
        switch (msg.type) {
          case 'ready':
            // 重新发送 init（面板被 retain 后恢复时无需额外动作，这里仅占位）。
            break;
          case 'save': {
            void this.saveInk(uri, msg.ink).then(
              () => (status.text = '$(check) ScribbleMD: 已保存'),
              (err) => {
                status.text = '$(error) ScribbleMD: 保存失败';
                vscode.window.showErrorMessage(
                  `ScribbleMD 保存失败: ${(err as Error).message}`,
                );
              },
            );
            status.text = '$(sync~spin) ScribbleMD: 保存中…';
            break;
          }
          case 'request-refresh': {
            void this.readMarkdown(uri).then((next) =>
              this.post(panel, { type: 'refresh', md: next }),
            );
            break;
          }
        }
      },
      null,
      this.disposables,
    );

    panel.onDidDispose(() => {
      this.panels.delete(uri.fsPath);
      status.dispose();
    });

    this.panels.set(uri.fsPath, panel);
  }

  private post(panel: vscode.WebviewPanel, msg: ToWebviewMessage): void {
    panel.webview.postMessage(msg);
  }

  /** 读取 Markdown 文本。优先用已打开的 TextDocument（拿到最新未保存内容）。 */
  private async readMarkdown(uri: vscode.Uri): Promise<string> {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === uri.toString(),
    );
    if (doc) {
      return doc.getText();
    }
    return fs.promises.readFile(uri.fsPath, 'utf8');
  }

  /**
   * 墨迹落盘路径：集中到 workspace 根目录的 `.scribblemd/` 下，
   * 按源文件相对路径组织，方便用户一眼看出对应关系并能整体 gitignore。
   * 没有打开 workspace 时，回退到扩展的 globalStorageUri（用路径 hash 命名）。
   */
  private inkPath(uri: vscode.Uri): string {
    const ws = vscode.workspace.getWorkspaceFolder(uri);
    if (ws) {
      const rel = path.relative(ws.uri.fsPath, uri.fsPath);
      const dir = path.join(ws.uri.fsPath, '.scribblemd', path.dirname(rel));
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, path.basename(rel) + '.ink.json');
    }
    // 没有 workspace：放到 globalStorage，用绝对路径的 hash 做文件名避免冲突。
    const storageDir = this.context.globalStorageUri.fsPath;
    fs.mkdirSync(storageDir, { recursive: true });
    const h = hashPath(uri.fsPath);
    return path.join(storageDir, `${h}.ink.json`);
  }

  private async loadInk(uri: vscode.Uri): Promise<InkDocument | null> {
    const file = this.inkPath(uri);
    try {
      const raw = await fs.promises.readFile(file, 'utf8');
      return JSON.parse(raw) as InkDocument;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  private async saveInk(uri: vscode.Uri, ink: InkDocument): Promise<void> {
    const file = this.inkPath(uri);
    ink.sourceUri = uri.toString();
    try {
      ink.sourceMtime = (await fs.promises.stat(uri.fsPath)).mtimeMs;
    } catch {
      /* 源文件可能已不存在，忽略 */
    }
    await fs.promises.writeFile(file, JSON.stringify(ink, null, 2), 'utf8');
  }

  /** 生成 Webview HTML，含严格 CSP、nonce、脚本引用与内联关键布局样式。 */
  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
    );
    const csp = webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${csp} https: data:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ScribbleMD</title>
  <style>
    /* 关键布局内联：确保即便外部样式未就绪，Canvas 也能正确覆盖正文。 */
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;height:100%;overflow:hidden}
    body{display:flex;flex-direction:column}
    #toolbar{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid rgba(128,128,128,.25);user-select:none}
    #scroll{flex:1 1 auto;overflow:auto;padding:24px 32px 96px}
    #content{position:relative;max-width:880px;margin:0 auto}
    #markdown{line-height:1.7}
    #ink-canvas{position:absolute;top:0;left:0;touch-action:none;pointer-events:auto}
    body[data-mode='hand'] #ink-canvas{pointer-events:none}
    .hint.is-hidden{opacity:0;pointer-events:none}
  </style>
</head>
<body data-mode="pen">
  <div id="toolbar">
    <div class="group" role="group" aria-label="工具">
      <button class="tool is-active" data-tool="pen" title="钢笔（P）"><i class="icon" data-icon="pen"></i></button>
      <button class="tool" data-tool="highlighter" title="高亮笔（H）"><i class="icon" data-icon="highlighter"></i></button>
      <button class="tool" data-tool="eraser" title="橡皮（E）"><i class="icon" data-icon="eraser"></i></button>
      <button class="tool" data-tool="hand" title="平移（G）"><i class="icon" data-icon="hand"></i></button>
    </div>

    <div class="group color-group" role="group" aria-label="颜色">
      <button id="color-btn" class="color-btn" title="颜色（点开色盘）">
        <span id="color-dot" class="color-dot"></span>
        <i class="icon" data-icon="pipette"></i>
      </button>
      <div id="color-pop" class="popover is-hidden">
        <label class="pop-row">
          <span class="pop-label">自定义</span>
          <input id="color-input" type="color" value="#e74c3c" />
        </label>
        <div class="pop-label">常用</div>
        <div id="presets" class="presets"></div>
      </div>
    </div>

    <div class="group" role="group" aria-label="粗细">
      <span class="width-label">粗细</span>
      <input id="width" type="range" min="1" max="16" step="0.5" value="2.5" />
      <span id="width-val">2.5</span>
    </div>

    <div class="spacer"></div>

    <div class="group" role="group" aria-label="操作">
      <button id="undo" title="撤销（Ctrl+Z）"><i class="icon" data-icon="undo"></i></button>
      <button id="redo" title="重做（Ctrl+Y）"><i class="icon" data-icon="redo"></i></button>
      <button id="clear" title="清空墨迹"><i class="icon" data-icon="trash"></i></button>
      <button id="toggle-md" class="is-active" title="显示/隐藏正文"><i class="icon" data-icon="eye"></i></button>
      <button id="refresh" title="重新抓取源文件快照"><i class="icon" data-icon="refresh"></i></button>
    </div>
  </div>

  <div id="scroll">
    <div id="content">
      <div id="markdown" class="markdown-body"></div>
      <canvas id="ink-canvas"></canvas>
    </div>
  </div>

  <div id="hint" class="hint">抓取快照中…</div>
  <div id="cursor"></div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/** 把绝对路径哈希成短文件名（djb2 变体，36 进制输出），用于无 workspace 时的回退存储。 */
function hashPath(p: string): string {
  let h = 5381;
  for (let i = 0; i < p.length; i++) {
    h = ((h << 5) + h + p.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
