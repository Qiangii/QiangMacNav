# macOS 27 图标

来源：[macos27.kimi.page](https://macos27.kimi.page/)，按用户提供的六张截图分类导出。

| 目录 | 内容 | 文件格式 |
| --- | --- | --- |
| `desktop-files/` | 桌面文件夹、文本文件、Utilities 文件夹 | 透明 PNG |
| `applications/` | Finder「Applications」及「Utilities」中的应用图标 | 透明 PNG |
| `finder-sidebar/` | Finder 侧边栏图标 | 透明 PNG、SVG |
| `settings-sidebar/` | 系统设置分类图标 | 透明 PNG |
| `music-sidebar/` | 音乐应用侧边栏图标 | 透明 PNG、SVG |

应用图标由网站的 SVG 线条和渐变样式组成。PNG 从页面渲染结果以 4 倍像素密度导出；侧边栏原有 SVG 另存一份，方便无损缩放。图片不含名称文字和窗口背景。`manifest.json` 记录每个文件的名称、分类和来源。

再次提取可运行 `tools/extract_macos27_icons.cjs`；需安装 Playwright，或将 `PLAYWRIGHT_MODULE` 指向已有的 Playwright 包。
