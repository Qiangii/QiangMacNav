# 前端组件与交互约定

## 数据和请求

- `src/types.ts` 定义当前接口契约；分类和站点使用 `editable/shared`，固定项统一使用 `dockItems`。创建内容自动归属当前用户。
- `src/api.ts` 统一 JSON、FormData、错误和 AbortSignal。仅 401 触发会话失效；503 保留会话，取消读取不显示错误通知。成功 JSON 必须为对象。
- App 并行读取 bootstrap／session，再加载 navigation。`sessionVersion` 防止旧会话请求覆盖新用户；`useNavigationSync` 定期同步可见内容，交互时暂停。
- 网页与插件共用 `useSessionActivity`，在前台打开、恢复可见或用户输入时按服务端给出的间隔检查续期。后台同步、在线通知和定时器仅刷新数据。插件提交收藏也向服务端报告活动。
- 偏好保存提交完整 `Preferences`，以服务端响应更新界面。`savePreferences` 统一保存锁及反馈；组件不要重复弹通知。
- `useNavigationIndex` 为 Dock 和桌面提供 ID 索引。`useEventCallback` 用于稳定事件引用和手势中读取最新状态。
- `accountValidation.ts` 统一账号及密码规则：账号 3–16 位，支持汉字（Unicode Han）、英文字母和数字，英文字母不区分大小写；密码 6–16 位且至少包含字母／数字／符号中的两类。账号和密码均按 Unicode 字符计数，每个汉字包括扩展区生僻字均计一位，不使用 HTML 的 UTF-16 长度限制代替字符校验。认证表单在输入法选字期间不以 Enter 提交。注册、改密和管理员重置共用提示；登录校验账号格式和密码长度，组合要求在设置密码时校验。前后端共享 `testdata/account-validation.json` 边界用例。
- `AuthScreen` 以 `setupRequired` 决定首次管理员模式，仅在 `setupTokenRequired` 为 true 时显示并提交初始化密钥。未配置 `SETUP_TOKEN` 时直接初始化。

## 窗口与通用 UI

从 `src/components/ui` 导入通用 UI。通用组件负责 DOM、键盘、焦点和生命周期，业务组件负责权限、API 与文案。

| 组件 | 约定 |
| --- | --- |
| `MacButton` | 默认 type=button；提交表单显式使用 submit，透传原生属性和 ref |
| `MacInput`、`MacTextarea`、`MacSwitch` | 透传原生语义和属性；开关由 checked/onChange 控制 |
| `MacSelect` | 受控单选；options 的 value 唯一，支持图标、键盘和可选 disabled。禁用项显示为只读，鼠标、方向键和键入匹配均不可选。网站与插件共享 mac-select.css |
| `MacSettingChoice` | 只有实际切换选项才调用 onChange |
| `MacWindow`、`useMacWindow` | 非模态窗口的几何、移动、缩放、最大化和边界限制 |
| `MacDialog`、`MacFormDialog` | 模态表单、Tab 圈定与关闭焦点恢复；ownedElementIds 包含其外部菜单 |
| `MacPresence` | 控制打开／关闭动画；减少动态效果时直接切换，关闭节点 inert |
| `MacScrollArea` | 原生滚动容器，可按 cacheKey 保存滚动位置，不额外嵌套 viewport |
| `MacTable` | 设置列表使用原生表格、列标题和稳定行键。业务组件提供列内容、空状态和分页，窄窗口可在表格内横向滚动。 |
| `MacTooltip` | 无交互提示、Portal、边界调整；菜单打开、拖拽和触屏时不显示 |
| `MacAlertDialog` | 异步确认、忙时防重入、失败保留重试；初始焦点在取消按钮 |

`useDesktopWindows` 统一管理 finder／settings 的 closed、visible、minimized 与层级。点击 Dock 图标时，已关闭或最小化的窗口会打开并置前。对可见窗口，按点击时其他上层可见窗口遮住的面积判断：超过目标窗口面积的 20% 时置前，等于或低于 20% 时关闭。多个窗口的重叠部分只计一次。`open(id)` 直接打开并置前，关闭或最小化最前窗口后焦点回到仍可见窗口。窗口几何由各自的 `useMacWindow` 保存。

TrafficLights 使用统一标题栏位置偏好，默认左侧；右侧按最小化、最大化、关闭排序。表单只有红色关闭按钮，忙时阻止关闭。`DesktopThemeContext` 和 `TitlebarPositionContext` 同样作用于 Portal。

## 编辑框、自动填充与校验提示

- 新增文本编辑框统一使用 `MacInput`／`MacTextarea`，保留原生 ref、受控值、输入法及 `autoComplete` 语义。共享样式位于 `src/components/ui/form-controls.css`，由通用控件加载，覆盖全站 `input`／`textarea` 的标准 `:autofill` 和 `:-webkit-autofill` 状态，包括悬停和聚焦。
- 输入框的普通状态与自动填充状态共用 `--field-background` 和 `--field-text`。默认透明背景、主题文字色；需要独立底色或文字色时，在具体输入框上覆盖变量，并以 `background: var(--field-background)`、`color: var(--field-text)` 绘制普通状态。主题使用 `color-scheme`；Portal 必须继承正确的 `.theme-light`／`.theme-dark`。
- 登录、Launchpad、桌面搜索等透明编辑框保留父容器的玻璃背景。共享自动填充样式将浏览器背景裁剪到文字，以内阴影恢复实色表单的底色，并设置文字和光标颜色；不要给透明框加不透明遮罩，也不要以关闭自动填充、超长 transition 或逐页复制覆盖代码来修复颜色。
- 新增或修改编辑框后，检查深浅主题、普通／自动填充／聚焦／禁用状态、透明和实色容器及窄屏。真实自动填充或浏览器强制 `autofill` 伪状态才会触发该样式；普通脚本 `fill()` 不能代替自动填充样式验证。强制颜色模式使用系统文字色。
- 账号与密码的默认占位文案共用 `USERNAME_PLACEHOLDER`／`PASSWORD_PLACEHOLDER`，统一为“账号（3–16 位）”“密码（6–16 位）”；说明使用完整、简洁的中文语句。注册、改密及管理员重置提交校验失败后，才显示 `PASSWORD_HINT`，以错误边框和 `role="alert"` 提示说明原因；输入关联 `aria-invalid`、`aria-describedby`，并聚焦首个错误字段。开始修改相关字段时清除旧提示，下一次提交再校验。确认密码不一致同样定位到确认框；管理员重置留空有效。
- 普通表单使用 `.editor-form`／`.settings-account-form` 与 `.mac-field-error`，登录页使用 `.lock-form` 的错误容器；字段校验不重复发顶部通知。请求失败继续由现有错误反馈处理，保持用户草稿。

## 导航、Dock、桌面

- 站点和分类菜单按快捷方式是否已存在显示「添加到桌面」或「从桌面移除」。桌面网站和分类单击打开，Ctrl／Command／Shift 加单击用于多选，拖动放手不触发打开。

- 删除站点或分类、移除桌面快捷方式和 Dock 图标时，`IconTransitions` 在图标原位播放碎散效果。新增桌面或 Dock 图标在布局完成后的落点聚合显现。动效依据数据中的成员变化触发，首次加载、排序及切换分类时保持稳定。减少动态效果模式直接更新，粒子层对点击和辅助技术透明。

- 页面收到单独的 F12 按键时，在捕获阶段取消其默认行为，覆盖登录页、桌面和弹窗。全屏时 Win 键仍由操作系统处理。
- Finder 的分类标题、侧栏、站点右键／三点菜单复用 App 的操作与权限。分类共享规则见 [分类共享](CATEGORY_SHARING.md)。侧栏分类拖拽保存 `sidebarOrder`。
- 站点菜单的“复制到分类”紧随“移动到分类”。选择可写分类或“未分类”后，将可见站点的名称、网址、备注和图标复制到目标列表末尾。副本有独立 ID，可单独编辑、移动和删除。
- Finder 不提供“全部网站”浏览视图；初始化、恢复缓存、创建分类及分类删除／共享撤回后，没有有效选择时按左侧 `sidebarOrder` 自动选中第一个可见分类，只显示该分类的网站。有效选择继续保留；“未分类”有内容时可单独选中，无分类且有未分类网站时默认显示它，否则显示空导航。全局搜索仍搜索当前用户全部可见站点。
- 分类和网站由已登录的 `/api/navigation` 按会话用户返回本人数据及管理员主动共享的数据；`sidebarOrder`、Dock、桌面引用也按同一可见性过滤。共享内容仅所有者可修改。个人登录日志只返回当前会话用户的记录，用户列表及全站日志仅管理员可读，权限取自数据库会话与角色。`server/authorization_test.go`、`sharing_test.go` 覆盖跨用户资源 ID、伪造身份参数、越权读写、失效会话及共享撤回；新增接口必须执行对应的服务端权限检查。
- 导航默认使用手柄；longPress 模式 350ms 激活，短滑保留触屏滚动。拖动结束有点击保护；键盘空格开始、方向键移动、空格／回车放置、Esc 取消。
- `Launchpad` 是桌面和 Dock 分类的统一打开入口，共用分类查询缓存和滚动偏好。站点菜单支持 Shift+F10；编辑或确认弹窗关闭后返回原分类。`NAVIGATION_MENU_IDS` 纳入模态焦点范围。
- Dock 左侧固定内容独立横向滚动，右侧工具不收缩；默认工具为 navigation/search/settings，可手动添加 add。悬停放大使用单 RAF，页面或 Dock 隐藏时停止。
- 桌面保存锚点、参考行列数；响应式投影不写回，手动移动才保存。布局 PUT 携带上次快照，过期保存返回 409。多选拖动保留形状，任一成员碰到窗口、Dock 或搜索禁区即整组禁止放置。
- 手机宽度≤760px且搜索开启时，图标从搜索框下方整行开始，上方整段区域禁放。宽屏只避让搜索矩形。投影和拖拽共享禁区集合。

## 搜索与本地缓存

`siteSearch.ts` 统一 Finder／Spotlight 对完整可见站点的 name/url/note 搜索，不限制结果数。`useSearchInput` 在输入法 composition 期间保留原结果，确认后提交。Spotlight 空查询显示最近 20 个唯一站点 ID，过滤删除或不可见项，展示最新内容。

`desktopCache.ts` 的键空间为 `qiangmacnav:desktop:v1:<userId>:<key>`，160ms 合并写入，离开／隐藏／退出前 flush；读取优先内存队列。恢复必须验证类型、内容和当前权限，损坏或禁用存储不影响使用。子树以用户 ID 为 key，避免跨账号状态复用。

workspace 保存当前窗口管理器状态、分类、查询与编辑目标；各窗口保存几何及滚动。编辑草稿明确取消、关闭或保存后清除。密码、会话凭据和删除确认不缓存。

桌面搜索仅缓存当前格式 `{x,y,width,bounds:{width,height}}`，按账号在浏览器内保存。缩放保持相对宽度与可移动空间中的位置比例，高度固定 52px，默认宽 560px。关闭开关清空几何，再开启恢复默认；引擎配置和开关由服务端保存。

默认引擎顺序为谷歌、推特、百度、必应，前后端配置保持一致。图标统一使用 `public/assets/icons/` 本地资源，`SearchEngineIcon` 在设置列表、编辑预览和桌面下拉中复用；内置引擎清空自定义图标后回退到同一本地图标。推特搜索使用 `https://x.com/search?q={query}`。旧数据库仅在首次更新时扩展未修改的谷歌／百度列表，保留开关及其他偏好；自定义名称、链接、图标、顺序和空列表保持原样，后续删除引擎不会在重启后恢复。注册显式写入当前默认配置，避免沿用旧数据库的列默认值。

## 媒体、反馈、品牌和更新

站点 `SiteIcon` 按原始宽高比放大到所在图标槽的边缘。背景填充仅绘制在图片自身的范围内，关闭时透明像素透出所在界面的背景。

`ImagePickerDialog` 组合通用表单、滚动和上传控件。`kind=image|avatar|wallpaper` 决定用途和资源库，`onSelect` 成功后关闭、失败保留草稿。内置清单与服务端 catalog 必须同步，来源及许可证保留在 [素材说明](../ASSET_NOTICES.md)。`MediaPreview` 图片失败才显示后备内容；`useVideoPlayback` 在后台或减少动态效果时暂停。

媒体删除广播事件，App 和打开的草稿清空相应引用；实际文件及引用在服务端事务中删除。网站 Logo 保存为独立公开副本，原上传保持私有。

通过 `useNotify()` 取得当前视图的通知函数，由 `MacToastHost` 显示顶部反馈。切换设置分类、导航分类或桌面窗口，以及最小化或关闭窗口时立即清除操作提示。异步操作使用发起时取得的通知函数，离开后才返回的结果也不会弹到其他界面。写入成功但刷新失败要说明“已保存，但列表刷新失败”，避免重复提交。失败保留草稿，通知使用主题变量、status/alert 语义且不抢焦点。

打开或关闭 `MacDialog`（包括嵌套确认框）、切换媒体库分类、切换登录与注册页或离开浏览器窗口时也清除临时反馈。页内操作提示可使用 `useViewFeedback`，插件收藏与浏览窗口遵循相同约定。正在运行的任务、仍需处理的同步错误及已收藏状态依据实际数据展示。

登录日志的“来源”列使用服务端的 `source: web | extension` 显示网页登录或插件登录，管理员另有账号列。IP 始终可见，展开“客户端信息”可查看完整 User-Agent。用户管理共用表格、分页和主题色，行操作沿用权限与确认弹窗。

`extensions/qiangmacnav` 共用网站主题变量、`MacButton`、`MacInput`／`MacTextarea`、自动填充样式和账号校验。浏览界面显示身份；收藏窗口仅显示表单，字段可滚动，分类和操作固定在底部。登录前跟随系统主题，登录后同步网站主题。首次确认导航地址时申请该主机权限；已配置主机缺少权限时由工具栏或右键点击触发申请。分类记忆按导航地址与用户 ID 隔离，右键采集信息可在授权和登录后继续使用。接口及权限见 [插件开发文档](../extensions/qiangmacnav/DEVELOPMENT.md)。

`SiteBrandingSettings` 保存名称和 Logo；bootstrap 驱动加载画面、登录页、浏览器标题和 favicon。`SystemUpdates` 仅管理员挂载，展示后端真实版本和项目仓库入口；进度来自真实任务状态，安装 POST 响应丢失后只查询。源配置、发布及回滚见 [在线更新](ONLINE_UPDATES.md)。

展开系统更新的版本说明时，按 GitHub Flavored Markdown 渲染正文，支持列表、表格、任务清单和代码块。相对链接以发布页为基准解析，网页链接在新标签页打开，原始 HTML 跳过渲染。

「上传安装包升级」可直接打开本地 `.tar.gz` 文件选择器。启动器支持本地上传时，管理员无需先检查更新即可确认上传并安装，随后复用系统更新任务状态与刷新入口。

本次查看期间观察到升级完成时，显示成功提示和刷新按钮，或在操作按钮下方显示失败原因。离开系统更新、切换窗口、最小化或关闭设置后清除结果，再次进入时只读取当前版本、进行中的任务和需要处理的恢复状态。重新检查成功也会清除上次结果。

自动检查：`npm run lint`、`node --test "scripts/*.test.mjs"`、`npm run build`。涉及权限或持久化时同时运行 Go 测试及 vet。
