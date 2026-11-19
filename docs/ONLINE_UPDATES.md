# 版本显示与 Docker 在线升级

版本源文件为 `server/internal/buildinfo/version.txt`。管理员可在“系统设置 → 系统更新”查看运行版本、检查新版或打开项目仓库。发布构建同时记录提交和构建时间。

## 单容器网页升级

在群晖「映像 → 运行」使用镜像默认启动命令，把站点专用文件夹读写挂载到 `/data`，映射网站端口即可。网站管理员在「系统设置 → 系统更新」点击「检查更新」，有更高版本时选择「在线升级」。外部 updater、Docker socket 和用户配置的密钥都是整容器替换模式使用的配置项。

启动器以普通用户运行，按 CPU 架构下载同一 GitHub Release 下的 `navigation-linux-amd64.tar.gz` 或 `navigation-linux-arm64.tar.gz`，根据 `update.json` 校验 SHA-256。安装前停止网站并备份 SQLite，恢复写入前检查新程序报告的版本和网站接口。如果验证失败或在验证过程中重启，启动器恢复之前的网站和数据库。`/data/.navigation-updates` 存放安装状态、网站版本和数据库备份，迁移 NAS 时请备份整个 `/data`。正常重启后继续运行已安装的网站版本。基础系统与启动器由镜像提供，要升级这两项请手动拉取新镜像并沿用数据目录重建。

本系列初始版本为 `v1.0.0`。之前安装的镜像需要手动更换一次。刚发布初始版时，页面显示已是最新版；以后发布的版本须包含对应架构的升级包和摘要。

## 可选的整容器升级模式

- 管理员可检查 GitHub 最新稳定版，查看说明，确认后升级前端和 Go 服务。普通用户无法调用管理接口。
- 单实例 Docker Compose 部署使用独立 updater 服务替换应用容器，保留端口、环境变量、数据卷、网络及重启策略。主应用继续以10001:10001运行，不挂载Docker socket。
- 在线升级读取公开仓库 `Qiangii/QiangMacNav` 的稳定版 Release、附件 `update.json` 及公开镜像 `ghcr.io/qiangii/qiangmacnav`。首次发布前可从源码部署。GitHub 返回 404 时页面提示尚未找到公开的稳定版本及升级清单。
- 升级器使用Docker API v1.41（Docker20.10及以上且支持该API）；目前在Docker Desktop29.3.1的Linux容器环境验证。默认目标容器为harbor-navigation，数据库必须为/data/navigation.db，updater必须挂载同一/data。
- 原生Go运行可检查版本，但不执行自替换。Kubernetes/Swarm、多副本共享数据库、私有GitHub/GHCR认证及跨升级协议版本迁移不在当前在线升级范围。

## 群晖项目启用整容器升级

下载仓库中的[群晖项目配置](../compose.synology.yaml)，在 File Station 中保存为 `docker/QiangMacNav/compose.yaml`。同一个项目会启动网站和 updater。

1. 在项目目录中准备 `data` 和 `updates` 两个文件夹。如果已有网站，先在旧容器的「存储空间」中核对 `/data` 对应的 NAS 文件夹，再停止旧容器并备份整个数据文件夹。新项目要使用原文件夹；如果旧容器名为 `harbor-navigation`，停止后将其改名，给项目腾出名称。
2. 在 `compose.yaml` 旁创建名为 `.env` 的纯文本文件。按实际情况填写下方配置，保留原站点端口、反向代理等设置。用密码管理器生成至少 32 个字符的随机字母和数字，填入 `UPDATER_TOKEN`。网站和 updater 都会读取这一个值。

   ```dotenv
   HOST_PORT=8088
   DATA_DIR=/volume1/docker/QiangMacNav/data
   UPDATE_STATE_DIR=/volume1/docker/QiangMacNav/updates
   UPDATER_TOKEN=
   ```

3. 打开 Container Manager → 项目 → 新增，选择项目目录和其中的 `compose.yaml`，然后启动。`data-init` 以退出码 `0` 停止表示数据权限准备完成。`navigation` 和 `updater` 应持续运行。项目内部使用 `8090`，NAS 只需对外提供网站端口。
4. 打开 `http://群晖IP:8088`（或原站点地址）。迁移旧站时，用原管理员账号登录并确认导航数据。进入「系统设置 → 系统更新」点击「检查更新」。如果页面提示需要启用 Docker 升级服务，先在项目中查看 updater 日志；发布了更高版本且 updater 就绪时，「在线升级」按钮可用。

## 使用命令行启用整容器升级

原有单容器需先按新配置重建一次。之后兼容升级协议的应用版本可从网页升级。

仓库完成首次公开发布后，在`.env`使用以下地址，并填写新的升级服务密钥：

```dotenv
SETUP_TOKEN=
UPDATE_REPOSITORY=Qiangii/QiangMacNav
UPDATE_IMAGE=ghcr.io/qiangii/qiangmacnav
NAVIGATION_IMAGE=ghcr.io/qiangii/qiangmacnav:latest
# 填入自己生成的随机密钥（至少 32 字符）
UPDATER_TOKEN=
```

保留原DATA_DIR、HOST_PORT和可信代理配置。SETUP_TOKEN可选，配置后仅用于首次创建管理员，已有账号时不参与更新。UPDATER_TOKEN只在后端与updater之间使用，不进入浏览器；可用`openssl rand -hex 32`生成。UPDATE_IMAGE不含标签或digest。在线更新通道使用`:latest`；默认本地构建通道`harbor-navigation:local`也支持，不将固定版本标签悄悄改为新版本。

主应用和updater共用默认源解析：UPDATE_REPOSITORY空值采用项目仓库，其镜像未填写时采用上述GHCR地址；自定义仓库必须填写对应UPDATE_IMAGE。首次发布前保持NAVIGATION_IMAGE未设置，继续从本地源码构建，不能拉取尚不存在的镜像。默认源仅允许检查，在线安装仍要求有效稳定版清单、镜像摘要和可用updater。

使用已发布镜像：

```sh
docker compose -f compose.yaml -f compose.updates.yaml pull
docker compose -f compose.yaml -f compose.updates.yaml up -d --no-build
```

首次从源码构建可不设置NAVIGATION_IMAGE，执行：

```sh
docker compose -f compose.yaml -f compose.updates.yaml up -d --build
```

Compose文件新增了updater和持久卷navigation-updates，原navigation-data或DATA_DIR继续使用。后续手动执行Compose时始终带上两个文件。在线成功后会同步原更新通道的本地镜像标签；旧源码的`--build`仍会明确重新构建旧版本，升级后不要用过时源码覆盖当前部署。

updater需要Docker socket权限，因此可以控制该Docker守护进程，属于高权限组件。它不发布8090端口，只允许携带私密token访问固定的状态/升级/恢复接口，并限制预配置的目标容器和镜像仓库。不要将socket挂到主应用，也不要把updater端口映射到公网。此权限是替换应用容器所必需的部署选择。

## 整容器模式的网页流程

1. 管理员打开系统设置，点击左侧“系统更新”。页面显示项目GitHub仓库入口及当前运行版本。
2. 点击“检查更新”；成功结果缓存30秒，网络失败明确通知，可重试。只接受x.y.z稳定版，自动排除预发布、草稿、无清单或不兼容协议。
3. 查看版本说明，点击“在线升级”并确认。浏览器提交检查得到的版本和digest；升级器再次核对最新发布信息，拒绝版本变化、降级和重复任务。
4. 下载阶段继续提供服务。下载并检查镜像版本、协议和健康检查后，创建维护标记，暂停写入，停止应用并备份SQLite数据库及WAL/SHM；上传资源也保存在同一数据库中。
5. 保留旧容器，创建新容器并等待健康检查，最长150秒。整个任务最多20分钟；失败后的恢复最多5分钟。
6. 成功后解除维护、同步镜像通道标签、清理已停止的旧容器，保留备份。页面自动重连并提供“刷新使用新版本”。关闭网页不取消后台任务，重新打开后读取进度。
7. 下载/镜像验证失败不停止原应用。替换或健康检查失败时停止新容器，恢复原数据库和旧容器，再解除维护。提交响应丢失时页面只查询任务，不自动重复提交。

维护期间所有JSON/上传写入返回503及Retry-After:10，读取与健康检查可继续。这样新版本验证失败后恢复备份不会丢掉维护期间新接收的写入。网页显示阶段和状态，不伪造下载百分比。

## 发布新版本

### 同时发布到 Docker Hub

在 Docker Hub 的个人命名空间创建公开仓库 `qiangmacnav`，并在 Account settings → Personal access tokens 生成有 Read & Write 权限的令牌。在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加下列仓库级配置。

| 位置 | 名称 | 值 |
| --- | --- | --- |
| Variables | `DOCKERHUB_USERNAME` | Docker ID，与上述个人仓库的命名空间相同 |
| Secrets | `DOCKERHUB_TOKEN` | Docker Hub 访问令牌 |

配置后，版本标签工作流会把同一次构建的 `linux/amd64` 和 `linux/arm64` 镜像推送到 Docker Hub 与 GHCR，标签为 `vX.Y.Z` 和 `latest`。省略 `DOCKERHUB_USERNAME` 时仅发布 GHCR。群晖在 Container Manager 的「注册表」中搜索 `Docker ID/qiangmacnav` 即可下载。使用网页在线更新时按本文的 GHCR 通道配置部署。

### 发布步骤

普通分支推送和拉取请求运行 [CI 检查](../.github/workflows/ci.yml)。[标签发布](../.github/workflows/release.yml) 复用同一组检查，使用 GitHub 提供的 `GITHUB_TOKEN` 创建 Release 并推送 GHCR。仓库需启用 Actions，组织策略须允许发布任务取得 `contents: write` 和 `packages: write`。首次生成镜像后，在 GitHub Packages 确认包可见性为 Public，部署主机才能匿名拉取。

1. 修改`server/internal/buildinfo/version.txt`，使用递增的稳定版本，例如1.1.0。源码本地Docker构建时传`APP_VERSION=1.1.0`，或在`.env`同步该构建参数；构建会验证参数与源文件一致。
2. 将发布提交推送到 GitHub，再为该提交推送与源文件版本一致的新标签，例如 `v1.1.0`。
3. 工作流运行网页与插件的类型检查、测试及构建，运行 Go 测试与 vet，随后构建 `linux/amd64` 和 `linux/arm64` 镜像，推送版本标签及 `latest`。
4. GitHub Release 附带插件 ZIP、两个架构的网站升级包及 `update.json`。清单记录镜像摘要和每个压缩包的 SHA-256。

```json
{
  "version": "1.1.0",
  "digest": "sha256:这里是64位十六进制镜像摘要",
  "protocol": 1,
  "bundles": {
    "linux-amd64": "sha256:AMD64升级包的64位十六进制摘要",
    "linux-arm64": "sha256:ARM64升级包的64位十六进制摘要"
  }
}
```

运行端通过固定的GitHub API读取最新release，再读取同一标签下的update.json。镜像地址始终由部署时配置的UPDATE_IMAGE加`@sha256:...`构成，清单不能让浏览器指定任意镜像。镜像标签须与发布版本一致；下载后继续验证协议和健康检查。这里使用HTTPS发布源和Docker内容摘要校验，不包含独立代码签名体系。

版本源在Go二进制中嵌入；CI将提交和构建时间注入二进制，Docker镜像有版本/协议标签。应用镜像包含updater二进制；当前运行的独立updater保持原兼容协议，若升级器本身需要更新，用上述pull/up命令重建两个服务。协议不兼容时拒绝在线升级。

## 整容器模式的备份与故障恢复

任务状态存于updater的/state/job.json，备份存于/state/backups/任务ID/。该目录来自navigation-updates卷，重启updater仍保留状态和备份。备份使用停止数据库后的完整文件复制，避免仅复制主库而丢失WAL内容。

备份暂不自动轮换；请预留数据库副本及镜像空间，并定期把确认不再需要的备份转存/清理。不要删除仍在升级或等待恢复的任务备份。删除旧容器不会删除数据卷，也不会自动删除旧镜像。

查看状态和日志：

```sh
docker compose -f compose.yaml -f compose.updates.yaml exec updater /app/updater status
docker compose -f compose.yaml -f compose.updates.yaml logs --tail=100 updater
```

若updater在替换中途重启，任务会标为interrupted，保留维护标记，阻止新升级。应用可能暂时无法访问，可在终端恢复：

```sh
docker compose -f compose.yaml -f compose.updates.yaml exec updater /app/updater recover
docker compose -f compose.yaml -f compose.updates.yaml exec updater /app/updater status
```

恢复会确认目标仍属于原任务，再停止新容器、恢复备份并启动旧容器。旧容器被外部删除、目标已被其他操作替换、维护标记丢失或Docker不可用时不会盲目覆盖数据库；保留interrupted状态和备份，查看日志后手动处理。若升级已经完成且健康检查成功，清理旧容器失败只记录日志，不会再回滚已投入使用的版本。

## API与代码位置

| API | 权限与用途 |
| --- | --- |
| GET /api/version | 公开只读；version/commit/builtAt，no-store |
| GET /api/admin/updates | 管理员；当前版本、缓存的发布结果、升级器可用性和持久任务进度 |
| POST /api/admin/updates/check | 管理员，同源；查询发布源并返回状态，短期缓存和并发互斥 |
| POST /api/admin/updates/install | 管理员，同源；仅接收version/digest，返回202任务，不接收命令/容器名/镜像仓库 |

`server/internal/updates`封装发布源、Docker客户端、备份与任务执行，`source.go`提供主应用与updater共用的默认源配置；`server/cmd/updater`是独立进程，`server/system_updates.go`提供主应用接口与维护模式。`SystemUpdates.tsx`负责仓库入口、版本状态、确认、重连及刷新；`src/project.ts`保存页面展示的项目仓库信息。Docker镜像OCI source标签也指向该项目，发布工作流沿用当前GitHub仓库生成镜像名。

## 数据库与验证

数据库结构以 `server/schema.go` 为准。空库创建版本 3，已有版本 1 和 2 在事务中升级并保留数据。在线更新器在启动新版本前备份数据库，健康检查失败时恢复原容器和对应数据库。

自动检查为 `go test ./...`、`go vet ./...`、前端类型检查、Node 测试和构建。`server/internal/updates` 覆盖发布来源、清单摘要、任务互斥、维护模式、备份恢复与中断处理。实际远程发布、下载以及目标 NAS／ARM64 环境需在发布前验证。
