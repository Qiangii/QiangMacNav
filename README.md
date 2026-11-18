# QiangMacNav

QiangMacNav 是一个 macOS 风格的自托管导航页。你可以在网页桌面整理常用站点，在 Chrome 或 Edge 中右键收藏当前页面，并用同一账号访问自己的导航。

## 功能

- 用户名登录、首次管理员初始化、注册开关、账户资料与头像、修改密码、会话管理；管理员可管理用户和查看登录日志。
- 个人分类与网站、拖拽排序、跨分类移动、Dock 固定和桌面快捷方式。可将站点复制到自己的分类，独立编辑副本。管理员可共享整个分类，其他已登录用户可浏览并固定其中的站点。详见 [分类共享](docs/CATEGORY_SHARING.md)。
- Finder 导航窗口、独立设置窗口、分类 Launchpad、Spotlight 全站点搜索和最近访问；支持右键、键盘、触屏及中文输入法。
- 桌面网格、多选拖拽、窗口与搜索框禁区、响应式布局。每账号最多 256 个快捷方式，自动适配屏幕不改保存位置，手动移动才保存。
- 深浅主题、10 项内置壁纸、24 个内置头像、图标库，以及按账号和用途隔离的头像／图标／壁纸上传库。支持图片、GIF 动图与 MP4 视频壁纸。
- 桌面网页搜索默认开启，依次提供谷歌、推特、百度、必应，四个默认图标均从本地素材目录加载，可编辑、排序和配置引擎图标。搜索框位置和宽度仅保存在当前浏览器，按账号隔离；引擎与开关保存在服务端。
- 网站名称和 Logo 配置、当前版本、GitHub 稳定版检查、可选 Docker 在线更新及失败回滚。
- [QiangMacNav 浏览器插件](extensions/qiangmacnav/README.md)：Chrome / Edge 账号登录、身份区分、分类与站点同步，以及右键「收藏进导航」。

新账号默认浅色、蜡笔小新壁纸、标题栏按钮靠左、导航拖拽手柄、图标背景开启、桌面定位网格关闭、Launchpad 横向分页。Dock 默认显示导航、搜索和设置，可手动开启“添加网站”。

## Docker 快速部署

### 群晖直接运行镜像

从 `v1.0.2` 起，在 Container Manager 的「注册表」下载官方镜像后，可以在「映像 → 运行」中直接创建网站容器。

1. 在 File Station 新建网站专用文件夹，例如 `docker/QiangMacNav/data`。
2. 将 NAS 的空闲 TCP 端口（例如 `8088`）映射至容器的 `8080`，将上述文件夹以读写方式挂载到 `/data`。
3. 保留镜像默认启动命令和用户。启动器会准备 `/data` 和已有 SQLite 文件的权限，然后以 `10001:10001` 运行网站。若 NAS 的 ACL 或网络文件系统禁止修改所有者，可使用 Docker 命名卷或预先为该身份授予写权限。
4. 打开 `http://群晖IP:8088` 创建管理员。如需限制首次注册，在启动前设置 `SETUP_TOKEN`。

单容器用户可在 Container Manager 中下载新版并重建容器，沿用同一 `/data`。需要网页一键升级时，在「项目」中导入 [群晖项目配置](compose.synology.yaml)，配置 `UPDATER_TOKEN`，并将 `DATA_DIR` 指向同一专用文件夹。该项目会启动网站和独立 updater。[在线更新说明](docs/ONLINE_UPDATES.md)

### 从源码构建

安装 Docker Engine 和 Compose v2 或更高版本。在仓库根目录执行以下命令，从源码构建并启动网页和 API 共用的容器。

```sh
cp .env.example .env
# 按需编辑 .env，再启动服务
docker compose up -d --build
```

打开 `http://服务器地址:8080` 创建首个管理员。若服务在初始化前已可从公网访问，先在 `.env` 设置 `SETUP_TOKEN`，由持有密钥的人完成初始化。留空时可直接创建首个账号。

`HOST_PORT` 修改宿主机端口。默认使用 `navigation-data` 命名卷；也可设置 `DATA_DIR=/volume1/docker/qiangmacnav/data`，提前创建该专用目录并授予容器 UID/GID `10001:10001` 写权限。数据库、密码哈希、导航、偏好、上传资源及网站 Logo 均在 `/data/navigation.db` 内。

当前数据库结构定义在 `server/schema.go`，版本为 3。空库进入首次管理员初始化。版本 1 和 2 的数据库自动事务升级，保留原有账号、会话、导航与登录来源。

反向代理部署填写准确的 `APP_ORIGIN`、`TRUST_PROXY=true` 和 `TRUSTED_PROXY_CIDRS`。CIDR 应为 Go 服务实际看到的代理来源地址；直连保持 `TRUST_PROXY=false`。应用部署在域名根路径，网页、`/api` 和 `/assets` 同源。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/`、`public/` | React 19、TypeScript 和 Vite 网页端，以及本地图标、头像和壁纸 |
| `server/` | Go / Chi API，负责账号、权限、导航、上传和 SQLite 持久化 |
| `server/cmd/updater/`、`server/internal/updates/` | 可选 Docker 更新服务及发布清单、备份和回滚逻辑 |
| `extensions/qiangmacnav/` | Chrome / Edge Manifest V3 插件，含后台、收藏窗口和独立构建入口 |
| `scripts/`、`testdata/` | 自动检查、素材处理脚本与测试数据 |
| `docs/` | 组件约定、分类共享和在线更新文档 |
| `Dockerfile`、`compose.yaml`、`compose.updates.yaml` | 应用镜像、基础部署和可选在线更新配置 |
| `.github/workflows/` | 分支与拉取请求检查、稳定版标签发布 |

## 浏览器插件

先在网页创建账号。从项目根目录运行 `npm ci` 和 `npm run build:extension`，再在 Chrome 或 Edge 的扩展管理页开启开发者模式，加载 `extensions/qiangmacnav/dist/`。也可从对应 Release 下载插件 ZIP，解压后加载含 `manifest.json` 的目录。首次打开插件时填写导航根地址，授权并登录即可收藏。[安装、权限与故障排查](extensions/qiangmacnav/README.md)

## 本地开发

需要 Go 1.23+、Node 22+。先在项目根目录执行 `npm ci`，再分别启动两个终端。

在 `server` 目录启动后端（PowerShell）：

```powershell
$env:APP_ORIGIN='http://127.0.0.1:5173'
go run .
```

在项目根目录启动前端：

```powershell
npm run dev
```

打开 `http://127.0.0.1:5173`。如需初始化密钥，可在启动后端前设置 `$env:SETUP_TOKEN='自己的随机密钥'`。Vite 将 API 代理到 `127.0.0.1:8080`。后端 `DB_PATH` 默认为相对启动目录的 `data/navigation.db`，可显式设置；`STATIC_DIR` 用于直接提供已构建网页。

检查命令：

```powershell
npm run lint
node --test "scripts/*.test.mjs"
npm run build
npm run test:extension
npm run build:extension
```

在 `server` 目录运行 `go test ./...` 和 `go vet ./...`。测试使用独立临时库，不向开发或部署数据库写入测试账号。

## 数据与接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/bootstrap`、`GET /api/session` | 初始化状态、是否需要初始化密钥、品牌、当前会话 |
| `POST /api/session/activity`、`POST /api/extension/session/activity` | 当前网页或插件会话前台使用续期，返回到期时间及距下一次检查的秒数 |
| `POST /api/auth/register\|login\|logout` | 注册、用户名登录、注销 |
| `GET /api/navigation` | 可见分类、网站、`dockItems`、桌面布局、侧栏顺序及完整偏好 |
| `/api/categories`、`/api/sites` | 内容管理；创建时自动归属当前账号 |
| `PUT /api/categories/{id}/sharing` | 管理员共享自己的分类 |
| `PATCH /api/sites/{id}/category` | 移动分类，保留网站其他内容 |
| `POST /api/sites/{id}/copy` | 将可见站点复制到自己的分类或未分类，返回副本 ID |
| `/api/pins/{id}`、`/api/category-pins/{id}` | 固定／取消固定网站与分类 |
| `POST /api/reorder` | Dock、侧栏、网站排序 |
| `/api/desktop-shortcuts`、`/api/desktop-layout` | 桌面快捷方式和带并发校验的布局保存 |
| `PUT /api/preferences` | 提交完整偏好；`wallpaperMime` 由服务端确定 |
| `/api/media`、`PUT /api/account/avatar` | 私有媒体及头像 |
| `/api/admin/settings`、`/api/admin/users`、`/api/admin/updates` | 网站管理、用户管理、系统更新 |
| `/api/extension/login\|session\|navigation\|sites\|logout` | 插件独立 Bearer 会话与收藏，见 [插件开发文档](extensions/qiangmacnav/DEVELOPMENT.md) |

分类和网站返回 `shared`、`editable`，网站保留真实 `categoryId`。可见性和修改权限均在服务端检查。媒体用途为 `image`、`avatar`、`wallpaper`；文件内容保存在数据库中。网站 Logo 使用独立公开副本，删除原私有上传不会破坏已保存的品牌。

API 使用 HttpOnly Cookie、同源校验和严格 JSON 解码。账号为 3–16 位，支持汉字、英文字母和数字，英文字母不区分大小写；密码为 6–16 位，至少包含字母、数字、符号中的两类，注册、修改密码和管理员重置使用相同规则。账号和密码均按 Unicode 字符计数，每个汉字计为一位。密码存储使用带应用域标识的 SHA-256 预处理及加盐 bcrypt，完整处理多字节密码。登录按 IP／账号限流，密码计算限制并发；会话数据库故障返回 503，避免误退出。登录日志保留近 90 天、最多 10,000 条。

网页和插件会话分别计算有效期。登录时有效期为 30 天，前台打开、切回或交互时，每 24 小时最多续期一次，续至当时起 30 天，最晚到本次登录后第 90 天。实际闲置期限约为 29–30 天，临近 90 天上限时以该上限为准。自动同步仅校验会话。过期或撤销后需重新登录。

bootstrap 的 `setupRequired` 表示尚无账号，需要创建首个管理员；`setupTokenRequired` 表示此时还配置了初始化密钥。初始化完成后两项均为 false，后续注册创建普通用户。

浏览器插件使用独立的 Bearer API，复用服务端登录校验、导航可见性和收藏归属检查。网页登录和插件登录在记录中以 source 明确区分；网页 Cookie 与插件令牌不能互换。

窗口状态、表单草稿、最近访问和搜索框几何信息使用 `qiangmacnav:desktop:v1:<userId>:` 本地缓存，不跨浏览器或设备同步。密码与会话凭据不写入该缓存，清除浏览器站点数据可重置本地工作区。

## 备份与更新

备份前停止服务，复制整个数据库目录，保留存在的 `navigation.db-wal` 和 `navigation.db-shm`。更新程序时保留数据卷；`docker compose down -v` 会删除命名卷中的数据。

版本号取自 `server/internal/buildinfo/version.txt`。发布工作流在推送匹配的 `vX.Y.Z` 标签时构建多架构镜像、插件 ZIP 和 `update.json`。公开发布后可使用 `ghcr.io/qiangii/qiangmacnav:latest`。管理员要从网页安装更新，还需启用 `compose.updates.yaml`，并为应用和 updater 配置同一个 `UPDATER_TOKEN`。[在线更新、首次发布与故障恢复](docs/ONLINE_UPDATES.md)

组件及交互约定见 [组件指南](docs/COMPONENTS.md)。本地素材和许可证见 [ASSET_NOTICES.md](ASSET_NOTICES.md)。
