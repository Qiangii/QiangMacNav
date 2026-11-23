# QiangMacNav

QiangMacNav 是一个 macOS 风格的自托管导航页。你可以像使用桌面一样整理网站、搜索、设置快捷方式和写便签，也可以通过 Chrome 或 Edge 插件把网页收藏到自己的导航。

[功能](#功能) · [首次初始化与防抢注](#首次初始化与防抢注) · [常规部署](#常规部署) · [Docker 部署](#docker-部署) · [NAS 部署](#nas-部署) · [数据持久化与备份](#数据持久化与备份) · [浏览器插件](#浏览器插件)

## 功能

- **桌面与窗口**。Finder 导航、设置和便签窗口支持拖动标题栏以及四边、四角缩放。桌面支持多选、网格布局、快捷方式和 Dock 固定，也适配触屏和窄屏。
- **导航与搜索**。网站可分类、复制、移动和拖拽排序。桌面、导航窗口和 Launchpad 松手即显示排序结果，后台依次保存。Spotlight 支持站点搜索和最近访问，桌面搜索框支持自定义引擎。
- **桌面便签**。在桌面空白处右键「新建便签」。标题同步到桌面图标，正文支持富文本与 Markdown 切换和预览，可设置文字颜色与背景色。粘贴或上传的图片可和文字排在同一行，拖动任一图片边缘即可按比例调整尺寸。标题、正文和图片加密存储，只有所属账号可访问。[便签说明](docs/NOTES.md)
- **账号与共享**。支持防抢注令牌、注册开关、头像、密码和会话管理。管理员可管理用户、查看登录日志、共享自己的分类及配置网站名称和 Logo。[分类共享](docs/CATEGORY_SHARING.md)
- **主题与媒体**。支持深浅主题、桌面壁纸、头像和图标库，可上传图片、GIF 和 MP4 壁纸。
- **浏览器插件与系统更新**。Chrome、Edge 可右键「收藏进导航」。系统设置提供稳定版检查，Docker 部署支持在线更新、本地安装包升级及适用模式下的失败回滚。[浏览器插件](extensions/qiangmacnav/README.md) · [系统更新](docs/ONLINE_UPDATES.md)

桌面便签从 `v1.1.0` 开始提供。已有 Docker 或 NAS 部署可沿用原 `/data` 挂载升级。[GitHub Releases](https://github.com/Qiangii/QiangMacNav/releases)

## 首次初始化与防抢注

空数据库启动后需要创建第一个账号，该账号会成为管理员。服务在局域网或公网开放前，建议先设置 `SETUP_TOKEN`，避免其他人先完成初始化。

1. 用密码管理器生成一段随机令牌，或执行 `openssl rand -hex 32`。将同一个值填入启动环境的 `SETUP_TOKEN`。常规部署用环境变量，Compose 用 `.env`，群晖运行镜像时在「环境变量」中添加。
2. 打开网页的「创建管理员」页面，把令牌填入「初始化密钥」，再填写显示名称、账号和登录密码。账号为 3–16 位汉字、英文字母或数字；密码为 6–16 位，至少包含字母、数字、符号中的两类。
3. 初始化完成后用登录密码进入站点。若只打算自己使用，在「系统设置 → 系统管理 → 访问设置」关闭「开放用户注册」。

`SETUP_TOKEN` 可留空，留空时第一个访问者可直接创建管理员。它仅在没有账号时生效，对已有数据库中的账号无影响。已有站点迁移或重建容器后，挂回原数据目录即可用原账号登录。

## 常规部署

网页静态文件和 API 由同一个 Go 进程提供，访问时只需一个端口。

### Linux 使用发布包

从 [GitHub Releases](https://github.com/Qiangii/QiangMacNav/releases) 下载匹配设备架构的 `navigation-linux-amd64.tar.gz` 或 `navigation-linux-arm64.tar.gz`。解压到安装目录，确认 `navigation` 与 `dist/` 在同一级。下面在该目录执行，`SETUP_TOKEN` 请换成自己的随机值。

```sh
mkdir -p data
chmod +x navigation
export HOST=127.0.0.1
export PORT=8080
export STATIC_DIR="$PWD/dist"
export DB_PATH="$PWD/data/navigation.db"
export SETUP_TOKEN='替换为生成的随机令牌'
./navigation
```

打开 `http://127.0.0.1:8080` 初始化。需要通过服务器的内网 IP 直接访问时，将 `HOST` 改为 `0.0.0.0`，并确认防火墙允许所用端口。长期运行时，可用系统服务或进程管理工具托管这个进程。

### 从源码构建

需要 Node.js 22+、npm 和 Go 1.23+。在项目根目录执行：

```sh
npm ci
npm run build
go -C server build -o ../navigation .
```

Linux 或 macOS 构建后，使用上一节的启动配置。Windows PowerShell 使用以下命令构建并运行：

```powershell
npm ci
npm run build
go -C server build -o ../navigation.exe .
$env:HOST = '127.0.0.1'
$env:PORT = '8080'
$env:STATIC_DIR = Join-Path (Get-Location) 'dist'
$env:DB_PATH = Join-Path (Get-Location) 'data/navigation.db'
$env:SETUP_TOKEN = '替换为生成的随机令牌'
.\navigation.exe
```

直接运行时，`HOST` 默认 `127.0.0.1`，`PORT` 默认 `8080`。建议生产部署显式指定 `STATIC_DIR` 和 `DB_PATH` 的绝对路径，以免更换启动目录后读取了另一个数据库。

## Docker 部署

发布镜像同时支持 Linux AMD64 和 ARM64，可使用 `ghcr.io/qiangii/qiangmacnav:latest` 或 `docker.io/qiangiii/qiangmacnav:latest`。需要锁定基础镜像版本时，将 `latest` 替换为已发布的 `vX.Y.Z` 标签。

### 使用 Docker Compose

安装 Docker Engine 和 Compose v2 或更高版本，在仓库根目录复制 `.env.example` 为 `.env`。用 PowerShell 时可执行 `Copy-Item .env.example .env`。

```sh
cp .env.example .env
```

在 `.env` 设置首次初始化令牌和宿主机端口。需要使用已发布的镜像时，再设置 `NAVIGATION_IMAGE`。

```dotenv
HOST_PORT=8088
SETUP_TOKEN=替换为生成的随机令牌
NAVIGATION_IMAGE=ghcr.io/qiangii/qiangmacnav:latest
# 留空使用命名卷。指定目录时请先创建该目录
# DATA_DIR=/volume1/docker/QiangMacNav/data
```

**使用发布镜像**

```sh
docker compose pull navigation
docker compose up -d --no-build
```

**构建当前源码**

在 `.env` 留空或省略 `NAVIGATION_IMAGE`，再执行：

```sh
docker compose up -d --build
```

打开 `http://服务器IP:8088`（按 `HOST_PORT` 调整）。可用 `docker compose logs -f navigation` 查看启动日志。

### 使用 docker run

无需仓库即可运行发布镜像。先准备一个本地 `.env` 文件，填入 `SETUP_TOKEN=你的随机令牌`，然后执行：

```sh
docker run -d --name qiangmacnav --restart unless-stopped \
  -p 8088:8080 --env-file .env \
  -v qiangmacnav-data:/data \
  ghcr.io/qiangii/qiangmacnav:latest
```

如需使用宿主机文件夹，将 `qiangmacnav-data:/data` 替换为 `/宿主机绝对路径:/data`。确保容器使用镜像自带的启动命令。

## NAS 部署

以群晖 Container Manager 为例。其他 NAS 的 Docker 管理界面中，按相同的端口、目录和环境变量配置即可。

1. 在 File Station 创建应用专用目录，例如 `/volume1/docker/QiangMacNav/data`。如果是重建或迁移已有容器，使用旧容器原来挂载到 `/data` 的目录。
2. 在 Container Manager 的「注册表」下载 `qiangiii/qiangmacnav:latest`，或者通过 GHCR 拉取 `ghcr.io/qiangii/qiangmacnav:latest`。在「映像」中选择镜像并创建容器。
3. 填写下表配置。端口 `8088` 是示例，可换成 NAS 上的空闲端口。

   | 配置项 | 群晖示例 |
   | --- | --- |
   | 端口设置 | 本地端口 `8088` → 容器端口 `8080`，TCP |
   | 存储空间 | `/volume1/docker/QiangMacNav/data` → `/data`，读写 |
   | 环境变量 | `SETUP_TOKEN` = 自己的随机令牌，首次启动前配置 |
   | 执行命令 | 保留镜像默认命令 `/app/start-navigation` |
   | 重启策略 | 可开启自动重新启动 |

4. 启动容器，访问 `http://NAS_IP:8088`，按[首次初始化与防抢注](#首次初始化与防抢注)完成设置。

镜像启动器会准备目录和 SQLite 文件权限，网站进程以 UID/GID `10001:10001` 运行。如果日志出现 `unable to open database file` 或提示无法准备 `/data`，先检查映射路径、读写模式和 NAS ACL，确保该身份能读写数据目录及其中的数据库和便签密钥。无法调整绑定目录权限时，可考虑 Docker 命名卷。

已有 SSH 或 Compose 环境时，也可按 [Docker Compose 部署](#使用-docker-compose)配置 `DATA_DIR=/volume1/docker/QiangMacNav/data`。需要通过网页替换整个容器时，可选择仓库的 [群晖项目配置](compose.synology.yaml) 及其配套 updater。[群晖项目与在线升级说明](docs/ONLINE_UPDATES.md#群晖项目启用整容器升级)

## 数据持久化与备份

Docker 部署请持久化**整个 `/data` 目录**。Compose 设置 `DATA_DIR` 时使用绑定目录，留空使用项目的 `navigation-data` 命名卷。NAS 已做整目录映射时，便签的数据库和密钥会随原目录一起持久化。

| 容器内路径 | 用途 |
| --- | --- |
| `/data/navigation.db` | 账号、导航、偏好、媒体及加密后的便签标题、正文和图片 |
| `/data/navigation.db.notes.key` | 便签加密密钥，包含便签功能的服务首次启动时自动生成 |
| `/data/navigation.db-wal`、`/data/navigation.db-shm` | SQLite 运行文件，备份时一并保留仍存在的文件 |
| `/data/.navigation-updates/` | 单容器网页升级安装的程序、状态和数据库备份（启用相应模式时） |

例如，将 NAS 的 `/volume1/docker/QiangMacNav/data` 挂载到 `/data`，密钥在 NAS 上就是 `/volume1/docker/QiangMacNav/data/navigation.db.notes.key`。原生部署使用 `<DB_PATH>.notes.key`；如果自定义了 `NOTE_KEY_FILE`，请另外备份那个路径的文件。

- **备份**。先停止服务，再复制整个数据目录。便签数据库和对应密钥必须一同保留，密钥请按敏感数据保管。
- **迁移或重建**。挂回原目录或原命名卷，并保持目录可写；旧版数据库会在新版启动时按迁移顺序升级。备份时保留一份升级前的数据。若恢复的库已有便签却缺少对应密钥，服务无法启动。
- **命名卷**。`docker compose down -v` 会删除该项目的命名卷。重建服务时沿用原卷；若更换项目名或安装目录，注意新项目可能会创建一个空卷。

## 反向代理与更新

站点部署在域名根路径，网页、`/api` 和 `/assets` 使用同一个地址。直连时保留 `TRUST_PROXY=false`。通过反向代理部署时，可开启 `TRUST_PROXY=true`，并把 `TRUSTED_PROXY_CIDRS` 限定为 Go 实际看到的代理来源，让应用识别客户端 IP 和 HTTPS。便签可用 HTTP 或 HTTPS 访问。HTTPS 提供传输加密，HTTP 以明文传输。

管理员可以在「系统设置 → 系统更新」查看实际运行版本。默认 Docker 启动器可升级网站程序；想更新容器基础镜像和启动器时，拉取新的镜像并使用原端口、环境变量和数据目录重建。原生运行请手动替换程序和匹配的 `dist/`。[在线更新、安装包与回滚](docs/ONLINE_UPDATES.md)

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/`、`public/` | React 19、TypeScript 和 Vite 网页端，以及本地图标、头像和壁纸 |
| `server/` | Go / Chi API，负责账号、权限、导航、上传和 SQLite 持久化 |
| `server/cmd/updater/`、`server/internal/updates/` | 可选 Docker 更新服务及发布清单、备份和回滚逻辑 |
| `extensions/qiangmacnav/` | Chrome / Edge Manifest V3 插件，含后台、收藏窗口和独立构建入口 |
| `scripts/`、`testdata/` | 自动检查、素材处理脚本与测试数据 |
| `docs/` | 便签、组件约定、分类共享和在线更新文档 |
| `Dockerfile`、`compose*.yaml` | 应用镜像、基础部署、群晖项目和可选在线更新配置 |
| `.github/workflows/` | 分支与拉取请求检查、稳定版标签发布 |

## 浏览器插件

先在网页创建账号。从项目根目录运行 `npm ci` 和 `npm run build:extension`，再在 Chrome 或 Edge 的扩展管理页开启开发者模式，加载 `extensions/qiangmacnav/dist/`。也可从对应 Release 下载插件 ZIP，解压后加载含 `manifest.json` 的目录。首次打开插件时填写导航根地址，授权并登录即可收藏。[安装、权限与故障排查](extensions/qiangmacnav/README.md)

## 本地开发

需要 Go 1.23+、Node 22+。先在项目根目录执行 `npm ci`，再分别启动两个终端。

在 `server` 目录启动后端（PowerShell）：

```powershell
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
| `GET /api/navigation` | 可见分类、网站、本人便签摘要、Dock、桌面布局、侧栏顺序及完整偏好 |
| `/api/categories`、`/api/sites` | 内容管理；创建时自动归属当前账号 |
| `PUT /api/categories/{id}/sharing` | 管理员共享自己的分类 |
| `PATCH /api/sites/{id}/category` | 移动分类，保留网站其他内容 |
| `POST /api/sites/{id}/copy` | 将可见站点复制到自己的分类或未分类，返回副本 ID |
| `/api/pins/{id}`、`/api/category-pins/{id}` | 固定／取消固定网站与分类 |
| `POST /api/reorder` | Dock、侧栏、网站排序 |
| `/api/desktop-shortcuts`、`/api/desktop-layout` | 桌面快捷方式和带并发校验的布局保存 |
| `/api/notes`、`/api/notes/{id}/images` | 私有便签与加密图片附件，按当前会话账号校验归属 |
| `PUT /api/preferences` | 提交完整偏好；`wallpaperMime` 由服务端确定 |
| `/api/media`、`PUT /api/account/avatar` | 私有媒体及头像 |
| `/api/admin/settings`、`/api/admin/users`、`/api/admin/updates` | 网站管理、用户管理、系统更新 |
| `/api/extension/login\|session\|navigation\|sites\|logout` | 插件独立 Bearer 会话与收藏，见 [插件开发文档](extensions/qiangmacnav/DEVELOPMENT.md) |

分类和网站返回 `shared`、`editable`，网站保留真实 `categoryId`。可见性和修改权限均在服务端检查。媒体用途为 `image`、`avatar`、`wallpaper`；文件内容保存在数据库中。网站 Logo 使用独立公开副本，删除原私有上传不会破坏已保存的品牌。

API 使用 HttpOnly Cookie 和严格 JSON 解码，并拒绝浏览器通过 `Sec-Fetch-Site` 标明由其他来源发起的写入。账号为 3–16 位，支持汉字、英文字母和数字，英文字母不区分大小写；密码为 6–16 位，至少包含字母、数字、符号中的两类，注册、修改密码和管理员重置使用相同规则。账号和密码均按 Unicode 字符计数，每个汉字计为一位。密码存储使用带应用域标识的 SHA-256 预处理及加盐 bcrypt，完整处理多字节密码。登录按 IP／账号限流，密码计算限制并发；会话数据库故障返回 503，避免误退出。登录日志保留近 90 天、最多 10,000 条。

网页和插件会话分别计算有效期。登录时有效期为 30 天，前台打开、切回或交互时，每 24 小时最多续期一次，续至当时起 30 天，最晚到本次登录后第 90 天。实际闲置期限约为 29–30 天，临近 90 天上限时以该上限为准。自动同步仅校验会话。过期或撤销后需重新登录。

bootstrap 的 `setupRequired` 表示尚无账号，需要创建首个管理员；`setupTokenRequired` 表示此时还配置了初始化密钥。初始化完成后两项均为 false，后续注册创建普通用户。

浏览器插件使用独立的 Bearer API，复用服务端登录校验、导航可见性和收藏归属检查。网页登录和插件登录在记录中以 source 明确区分；网页 Cookie 与插件令牌不能互换。

窗口状态、表单草稿、最近访问和搜索框几何信息使用 `qiangmacnav:desktop:v1:<userId>:` 本地缓存，不跨浏览器或设备同步。密码与会话凭据不写入该缓存，清除浏览器站点数据可重置本地工作区。

组件及交互约定见 [组件指南](docs/COMPONENTS.md)。素材与许可证见 [头像](public/assets/avatars/LICENSE.txt)、[Simple Icons](public/assets/icons/simple-icons-LICENSE.md)、[Lucide](public/assets/icons/lucide-LICENSE.txt)、[ThanasOS](public/assets/thanasos-LICENSE.txt) 和 [macOS 风格图标来源](public/assets/icons/macos27/source-README.md)。
