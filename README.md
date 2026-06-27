# ScribbleMD

> 在 Markdown 预览之上随手画两笔，墨迹还能跟着文件一起走。

[![GitHub](https://img.shields.io/badge/Github-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Nijika-jia/ScribbleMD)
[![made with typescript](https://img.shields.io/badge/made%20with-typescript-3178c6?logo=typescript&logoColor=white&style=for-the-badge&format=png)](https://www.typescriptlang.org/)
[![built with love](https://img.shields.io/badge/built%20with-love-ff69b4?style=for-the-badge&format=png)](https://github.com/Nijika-jia/ScribbleMD)
[![Install](https://img.shields.io/badge/Install%20from%20Marketplace-blue?style=for-the-badge&logo=vscode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=Nijikajia.scribbleMD)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-1.74%2B-0078D4?style=for-the-badge&logo=visualstudiocode&logoColor=white&format=png)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge&format=png)](./package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=for-the-badge&format=png)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge&format=png)](https://github.com/Nijika-jia/ScribbleMD/issues)

ScribbleMD 给你在 VS Code 里看 Markdown 时随手画两笔的能力。打开任意 `.md` 文件，点一下右上角的铅笔按钮，正文被渲染成一张冻结的快照，上面盖一层透明画布——钢笔、水彩笔、橡皮、色盘、撤销重做全都就位。画完的墨迹会自动存到 workspace 根目录的 `.scribblemd/` 文件夹下，按源文件相对路径组织，下次打开还在原来的位置。

## 特性

- 冻结快照：手写时正文不会因为编辑器刷新而跳动，画在哪就是哪
- 多种画笔：钢笔 / 水彩笔（半透明叠加）/ 橡皮 / 平移
- 色盘 + 预设：原生取色器选任意颜色，下方一排 10 个常用预设色
- 鼠标预览光标：当前画笔的颜色和大小实时跟随指针
- 撤销 / 重做：`Ctrl+Z` / `Ctrl+Y`，键盘党友好
- 显隐正文：临时切到纯墨迹视图
- 一键刷新：源文件改了之后重新抓取快照，墨迹保留
- 自动持久化：防抖 350ms 落盘，不会因为忘存而丢画
- 明暗主题自适应：所有颜色走 VSCode 主题变量

![demo](https://pic1.imgdb.cn/item/6a3fa9942546dff76d1d74a5.gif)
## 快速开始

1. 在扩展市场搜索 `ScribbleMD`，或用 [VSIX](#本地打包) 安装
2. 打开任意 `.md` 文件
3. 点击编辑器右上角的铅笔图标，或 `Ctrl+Shift+P` 执行 `ScribbleMD: 随手涂鸦`
4. 开画

## 工具栏

从左到右依次是：

| 工具 | 说明 | 快捷键 |
| --- | --- | --- |
| 钢笔 | 实线笔触，跟随压感（如设备支持） | `P` |
| 水彩笔 | 半透明粗笔，自相交处不会越画越深 | `H` |
| 橡皮 | 圆形擦除，半径跟随粗细 | `E` |
| 平移 | 让事件穿透到滚动条，可滚动浏览、选中文字 | `G` |
| 颜色 | 点开色盘，原生取色器 + 预设色 | — |
| 粗细 | 1 ~ 16 像素滑块 | — |
| 撤销 | 回退最后一笔 | `Ctrl+Z` |
| 重做 | 重做撤销的笔画 | `Ctrl+Y` / `Ctrl+Shift+Z` |
| 清空 | 一键擦掉所有墨迹 | — |
| 显隐正文 | 切换纯墨迹视图 | — |
| 刷新快照 | 重新抓取源文件最新内容 | — |

## 数据格式

墨迹集中存放在 workspace 根目录的 `.scribblemd/` 下，按源文件相对路径组织。例如源文件 `docs/intro.md` 的墨迹存放在 `.scribblemd/docs/intro.md.ink.json`。建议把 `.scribblemd/` 加进 `.gitignore`（如果想把标注随仓库分发，也可以选择提交）。结构如下：

```json
{
  "version": 1,
  "sourceUri": "file:///path/to/your.md",
  "sourceMtime": 1719475200000,
  "viewportWidth": 880,
  "strokes": [
    {
      "color": "#e74c3c",
      "width": 2.5,
      "highlight": false,
      "points": [
        { "x": 120.3, "y": 45.1, "p": 0.5 },
        { "x": 121.8, "y": 46.0, "p": 0.6 }
      ]
    }
  ]
}
```

- `sourceMtime` 用来记录抓取快照时源文件的修改时间，方便判断是否过期
- `viewportWidth` 是抓取时的视口宽度，正文宽度变化时可据此缩放
- `points.p` 是压感，范围 0~1

这是个普通的 JSON 文件，可以 git 追踪、可以手动编辑、可以写脚本批量处理。

## 本地打包

```bash
# 装依赖
npm install

# 开发构建（一次）
npm run compile

# 监听模式
npm run watch

# 打包 vsix
npx vsce package
```

装 vsix：

```bash
code --install-extension scribble-md-1.0.0.vsix
```

## 技术细节

- **Markdown 渲染**：浏览器端用 `markdown-it`，不依赖 VSCode 内置预览，避免双窗口同步问题
- **手写画布**：原生 Canvas 2D + Pointer Events + `setPointerCapture`，桌面 / 触屏 / 笔输入统一处理
- **样式注入**：CSS 用 esbuild text loader 打进 bundle 运行时注入 `<style>`，避免 webview 外链加载在某些环境下失败导致 Canvas 定位错乱
- **图标**：Lucide 风格 SVG 内联，无外部字体依赖
- **CSP**：严格内容安全策略，`script-src 'nonce-<random>'`，无 `unsafe-eval`

## 路线图

- [ ] 笔触压感真的用起来（目前只是记录）
- [ ] 多页 / 长文档滚动时的坐标稳定性
- [ ] 墨迹导入导出（PNG / SVG）
- [ ] 多人协作标注（远端共享 ink 文件）
- [ ] 自定义预设色持久化

## 贡献

欢迎提 Issue 和 PR。提 PR 前请先跑一遍 `npm run compile` 确认构建通过。

## License

[MIT](./LICENSE) © scribblemd
