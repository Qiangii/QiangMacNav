# 开发约定

QiangMacNav 是自托管的 macOS 风格导航页：React 19 + TypeScript + Vite 网页、Go（Chi）+ SQLite 单端口 API、Chrome / Edge Manifest V3 插件。前端修改遵循[组件与交互约定](docs/COMPONENTS.md)，用户部署说明见 [README](README.md)，更新机制见[在线更新](docs/ONLINE_UPDATES.md)。

## 现有功能与代码位置

| 功能 | 主要实现 |
| --- | --- |
| 账号、会话、登录限流、密码与管理 | `server/accounts.go`、`auth_security.go`、`password.go`；`src/components/AuthScreen.tsx`、`AccountSettings.tsx` |
| 分类、站点、共享、跨分类复制与网址去重 | `server/main.go`、`sharing.go`、`site_url.go`；`src/App.tsx`、`EditorDialog.tsx`、`CategorySidebar.tsx`、`CategorySection.tsx` |
| 桌面、Dock、启动台、拖拽与乐观排序 | `server/desktop.go`、`desktop_layout.go`、`main.go`（`/api/reorder`）；`src/components/DesktopShortcuts.tsx`、`Dock.tsx`、`Launchpad.tsx`、`useOptimisticNavigation.ts`、`src/navigationOrder.ts`、`src/optimisticQueue.ts` |
| 桌面搜索、Spotlight、最近访问 | `server/desktop_search.go`；`src/components/DesktopSearchWidget.tsx`、`Spotlight.tsx`、`siteSearch.ts`、`spotlightHistory.ts` |
| 桌面便签（加密存储） | `server/notes.go`、`schema.go`；`src/components/NoteEditor.tsx`、`noteTextStyle.ts`、`docs/NOTES.md` |
| 媒体、头像、壁纸、品牌与偏好 | `server/media.go`、`avatar_media.go`、`branding.go`、`*_preferences.go`；`src/components/ImagePickerDialog.tsx`、`WallpaperSettings.tsx`、`SiteBrandingSettings.tsx` |
| 系统更新与回滚 | `server/system_updates.go`、`server/internal/updates/`、`server/cmd/updater/`；`src/components/SystemUpdates.tsx`、`ReleaseNotes.tsx` |
| 浏览器插件 | `extensions/qiangmacnav/`，另见 `extensions/qiangmacnav/DEVELOPMENT.md` |
| 通用控件与窗口 | `src/components/ui/`；业务组件在 `src/components/` |

`src/api.ts` 与 `src/types.ts` 是网页接口契约的唯一来源；服务端字段变更时同步更新。`src/App.tsx` 负责会话、导航视图、窗口、菜单、编辑器和排序回调，具体界面拆到业务组件。

## 开发与验证

```powershell
npm ci
npm run lint                    # 仅 tsc --noEmit，没有 ESLint
node --test "scripts/*.test.mjs"
npm run build
npm run test:extension
npm run build:extension
```

```powershell
Set-Location server
go test ./...
go vet ./...
```

- 需要 Node.js 22+ 与 Go 1.23+。Windows PowerShell 使用 `npm.cmd`；Go 不在 PATH 时使用完整路径（例如 `& 'C:\Program Files\Go\bin\go.exe' test ./...`）。
- 本地联调：在 `server` 运行 `go run .`，在根目录运行 `npm run dev`；Vite 将 `/api` 代理到 `127.0.0.1:8080`。后端默认 `HOST=127.0.0.1`、`PORT=8080`，`DB_PATH` 默认为相对启动目录的 `data/navigation.db`。
- 测试使用独立临时库（`testApp` 或临时目录），不要向开发库、部署库或用户 NAS 写入测试账号。真实 UI 验证使用隔离实例或临时容器，完成后清理自己启动的进程和容器。
- 前端修改至少运行 `npm run lint`、相关 Node 测试和 `npm run build`。涉及接口、权限、持久化、排序事务或便签时还要运行 Go 测试与 vet；只跑类型检查不算完成验证。
- CI 还会校验两套 Compose 配置：设置临时 `UPDATER_TOKEN` 后运行 `docker compose --env-file .env.example config --quiet`，以及追加 `-f compose.updates.yaml` 的同一命令。

## 前端约定

- 界面文案使用中文。从 `src/components/ui` 引入通用控件；通用组件负责 DOM、键盘、焦点和生命周期，业务组件负责权限、API 与文案。新增窗口、弹窗、滚动区和菜单时优先复用现有 `Mac*` 组件，不要另写一套焦点或动画逻辑。
- 新增或修改文本编辑框使用 `MacInput`／`MacTextarea`，沿用 `form-controls.css` 的全站自动填充处理。普通状态与自动填充状态共用 `--field-background`／`--field-text`，透明框保留父容器背景，不关闭浏览器自动填充来规避样式问题。检查深浅主题、自动填充、聚焦、禁用和窄屏表现；普通脚本填值不能代替浏览器自动填充状态验证。
- 悬停专属的颜色、放大和提示限定在 `(hover: hover) and (pointer: fine)` 下，触屏点按不应残留悬停样式。保留键盘 `:focus-visible`、菜单活动项、分类选中、开关和表单状态。点击高亮已由 `styles.css` 的 `:root` 全局关闭；不要用全站 `blur()`、取消默认事件或删除焦点样式处理触摸反馈。
- 触屏常用入口保持可见：Dock 固定图标长按 220ms 排序，导航默认手柄、longPress 模式 350ms 激活；启动台和分类列表的关闭按钮保留 44 × 44 像素点击区域；站点菜单支持右键、菜单键和 Shift+F10。
- 密码组合要求只在填写后提交校验失败时显示，配合字段错误样式及可访问性属性；用户修改相关字段时清除旧错误。注册、修改密码和管理员重置保持一致，前后端共享 `testdata/account-validation.json` 边界用例。
- 通知使用 `useNotify()`；切换设置分类、导航分类、窗口、最小化或关闭后清除临时反馈。异步操作在发起时取得通知函数，离开后返回的结果不要弹到新界面。保存成功但刷新失败要提示“已保存，但列表刷新失败”，失败保留草稿。页内提示可用 `useViewFeedback`。
- `sessionVersion` 防止旧会话或旧请求覆盖新用户；`useNavigationSync` 在交互、拖拽、编辑、确认和保存期间暂停。请求统一走 `src/api.ts`，只有 401 让网页结束会话，503 保留会话。
- 排序写入统一走 `useOptimisticNavigation` 和 `OptimisticQueue`：界面持续投影待保存操作，服务端按提交顺序串行写入，失败撤销未确认批次并回读。新增排序入口必须提供可校验的前置快照（如 `previousIds`、桌面布局快照）并处理 409 冲突；保存期间不要禁用拖动，也不要等刷新才清理拖拽状态。
- 拖拽松手立即显示目标排列，再从松手位置平缓落位；`prefers-reduced-motion` 时直接落位。搜索期间禁用排序，清空搜索恢复。启动台、导航窗口和分类列表共享同一分类的站点顺序；总览中分类图标的穿插位置按账号保存在浏览器。旧后端不支持 `supportsCategorySiteOrder` 时走 `legacySiteOrder.ts` 的单站点移动兼容路径。
- 右键子菜单在挂载后测量实际尺寸并处理边缘与滚动（见 `ContextMenu.tsx`），不要使用固定宽度或按行数估算高度。菜单、弹窗和浮层保留键盘路径、关闭后的焦点恢复和可访问名称。
- 浮层与毛玻璃：桌面搜索的模糊由独立、不可点击的背景伪元素绘制，表单容器不重复设置 `overflow` 裁剪；输入与按钮层不使用 `backdrop-filter`。桌面与 `MacPresence` 的入场动画使用 `backwards`，不要用 `both` 保留已结束的透明层。启动台/搜索的模糊只作用于 `.desktop-scene`，关闭时在原位淡出。
- 本地界面状态使用 `desktopCache`，键空间为 `qiangmacnav:desktop:v1:<userId>:`，按账号隔离。只缓存可恢复的界面状态，不缓存密码、会话凭据或删除确认；读取时校验类型、内容和当前权限。
- 便签富文本与 Markdown 共用一份 Markdown 正文；预览只识别包含有效十六进制颜色的便签格式标记，其余原始 HTML 跳过。便签草稿不进入浏览器缓存，保存冲突保留编辑内容。

## 服务端与数据

- `server/schema.go` 的 `schemaVersion` 与迁移链是数据库结构的唯一来源。空库创建全量结构；已有库按版本在**同一事务**内逐级迁移并更新 `PRAGMA user_version`。修改已发布表结构必须新增版本和迁移，不要改旧迁移或要求用户重建库。`openDB` 固定 `SetMaxOpenConns(1)`，启用 WAL、外键和 busy timeout。
- 所有权限在服务端最终校验。可见性统一使用 `sharing.go` 的 `visibleCategoriesSQL`／`visibleSitesSQL`／`visiblePinsSQL`；返回的 `shared`／`editable` 只控制界面。管理员也不能读取他人私有导航或修改他人共享内容。新增资源与接口要补授权测试（参考 `authorization_test.go`、`sharing_test.go`）。
- 写入口在事务内完成校验与写入。站点新增、编辑、复制和跨分类移动（含 `reorder` 的 `sites` 分支）统一使用 `site_url.go` 的 `siteURLAvailable`：同一分类（含本人「未分类」）不能重复相同网址，同一网址可存在于不同分类；比较会统一协议/主机大小写、默认端口和空路径，冲突返回 409 与中文提示。新增站点写入路径不要绕过该检查。
- `POST /api/reorder` 按 `kind` 分支；`categorySites` 校验分类归属、`previousIds` 快照和成员集合后整组更新。新增排序类型同样要在同一事务内校验权限、快照和成员，失败时整体回滚。
- 网页会话使用 HttpOnly Cookie，插件使用独立 Bearer 会话；网页写请求校验 `Sec-Fetch-Site` 与 JSON Content-Type（媒体、便签图片和安装包上传除外）。密码使用带应用域标识的 SHA-256 预处理及加盐 bcrypt，账号和密码按 Unicode 字符计数。
- 媒体与网站 Logo 存在 SQLite；上传、删除和引用清理在事务内完成。分类/站点/便签删除依赖触发器清理 Dock 与桌面引用，改表时要保留这些触发器。
- 便签标题、正文和图片用 AES-256-GCM 加密，AAD 绑定账号、便签和字段；密钥为 `<DB_PATH>.notes.key`（或 `NOTE_KEY_FILE`，32 字节原始密钥）。首次启动原子生成，已有便签缺少密钥会阻止启动。备份和迁移必须同时保留数据库与密钥，不要把密钥提交到仓库或日志。
- 系统更新接口仅管理员可用，安装请求只接受 version/digest；维护期间写入返回 503 和 Retry-After。不要伪造进度，也不要把维护状态当成普通错误处理。

## 浏览器插件

- 独立构建：`npm run build:extension` 输出 `extensions/qiangmacnav/dist/`，`npm run test:extension` 运行插件测试。插件复用网站的 `MacInput`／`MacTextarea`、表单样式和账号校验，不关闭自动填充，不引入远程脚本。
- 插件登录前跟随系统主题，登录后同步网站主题；收藏使用独立 Bearer 会话，权限仍由服务端 `navigation`／`createSite` 等逻辑决定。修改接口时同步检查 `extensions/qiangmacnav/DEVELOPMENT.md` 与插件测试。
- 收藏成功后显示 3 秒倒计时并自动关闭，也可点击「完成」立即关闭；切换分类或离开窗口后清除旧提示，保留已填写草稿。

## 文档、版本与发布

- 更新通用交互时同步维护 `docs/COMPONENTS.md`。功能行为变化更新对应专题文档（`docs/NOTES.md`、`docs/CATEGORY_SHARING.md`、`docs/ONLINE_UPDATES.md`），用户可见说明同步 README。
- 版本号同时存在于 `server/internal/buildinfo/version.txt`、`Dockerfile`（两处 `APP_VERSION`）、`compose.yaml`、`.env.example`、`package.json`、`package-lock.json`（根包两处）和 `extensions/qiangmacnav/public/manifest.json`。发布说明写入 `docs/releases/vX.Y.Z.md`。
- 推送 `vX.Y.Z` 标签触发发布：工作流要求标签与 `version.txt` 一致，复用 CI，构建 AMD64/ARM64 镜像并发布 `update.json`、两个离线升级包和插件 ZIP。`docs/releases/vX.Y.Z.md` 会作为 GitHub Release 正文，请用中文分节写明功能与升级方式。未经用户明确要求，不要提交、推送标签或发布；发布前确认 `git status` 中没有无关或未完成改动。
- 提交信息使用简洁英文祈使句；版本发布提交以 `for vX.Y.Z` 结尾（沿用现有历史）。

## 工作区与安全

- 改动前先查看 `git status` 和 `git diff`，区分本次任务与他人正在进行的改动；不要顺手提交、格式化或删除无关文件。
- 不提交密钥、`.env`、数据库、构建产物或测试账号。脚本和测试不得连接用户的部署容器、`server/data/navigation.db` 或 NAS 数据。
- 需要真实 UI/API 验证时使用隔离实例与临时数据库；完成后停止自己启动的进程或容器，不要停止用户原有的部署。
