# Magpie Mirasim 版 · fork 维护说明

本仓库 fork 自 [yetone/magpie](https://github.com/yetone/magpie)，在上游基础上加了
Mirasim 支持和几个供应商插件。本文说明这个 fork 怎么组织、怎么跟进上游、怎么发自己的版本。

## 分支与版本

| 名称 | 含义 |
|---|---|
| `main` | 上游 `yetone/magpie` 的 `main` 的**纯镜像**，只能快进，不放我们的提交 |
| `feat/mirasim` | **产品分支**，也是 fork 的默认分支：上游加上我们的提交 |
| `mirasim-v0.1.550.1` | 安装过的构建打的 tag：`mirasim-<所基于的上游 tag>.<序号>` |

- 吸收上游一律用 **merge，不用 rebase**，因此不需要 force-push，历史能看出每次合并了哪个上游版本。
- 构建版本号是 `mirasim-<上游 tag>+<commit>`（见 `build/mirasim-app.sh`）。这个格式**故意解析不成 semver**，
  因为官方的自动更新器只升级“正式版”号，能解析就会把定制版替换成官方版。
  `internal/update/mirasim_version_test.go` 专门守这一点：哪天上游改了判断逻辑，合并后测试会直接失败。
- `upstream` remote 的 push 地址设成了 `DISABLED`，避免误推到上游。

## 我们改了什么

### 1. 插件（`plugins/`），不碰上游代码

| 插件 | 作用 | 外部依赖 |
|---|---|---|
| [`plugins/cohub`](plugins/cohub/README.md) | 接入 Cohub 的模型，仅限纯文本对话 | 本机安装的 `@neta-art/cohub-cli`，自动选用最新版 |
| [`plugins/antigravity`](plugins/antigravity/README.md) | 包装 Antigravity 社区插件，补上原生额度 | `../magpie-antigravity-auth`，**钉在指定 commit** |

插件用 Magpie 的 OpenCode 插件协议，和上游代码完全解耦，上游怎么改都不会冲突。新的供应商能做成插件的，都优先做成插件。

### 2. Mirasim 核心补丁

Mirasim 目前**做不成插件**，原因有两个：

1. **Claude Code 启动器**：要让 Magpie 的 Claude Code 行实际执行 `mirasim claude`，恢复会话也要走它。
   插件协议没有“启动 agent”这类钩子，只能改 `internal/agent/claude.go` 和 `internal/sessions/sessions.go`。
2. **请求签名**：Mirasim 平台要求请求带原生客户端签名，签名代理只在 `mirasim claude` 进程内部临时存在，
   没法单独拉起来复用。所以我们复用上游 Go 写的 Claude CLI 桥（`internal/claudebridge`，支持工具往返）去调用 `mirasim claude`。
   改成插件就要用 JS 重写一遍这个桥，维护成本反而更高。

为了合并省事，Mirasim 的逻辑都放在**新文件**里（`internal/mirasim/`、`internal/provider/mirasim*.go`、
`internal/gateway/mirasim.go`、`mirasim_cli.go` 等），上游原有文件只加最少的接入点。
当前只改了 19 个上游文件，共 +155/−10 行，合并冲突只可能出在这些地方：

```sh
git diff --name-status main...feat/mirasim | grep '^M'   # 被改动的上游文件
git diff --stat main...feat/mirasim                       # 全部差异
```

如果哪天上游开放了“自定义 Claude 启动命令”或“Claude CLI 桥接自定义命令”这类通用能力，
这部分补丁就能缩成插件加配置。

## 跟进上游

### 自动巡检

`.github/workflows/upstream-watch.yml` 每天 09:17（UTC+8）运行一次，也可以在 Actions 页手动触发：

- 把 `main` 同步到上游（GitHub 的 fork 同步碰到上游改了工作流文件时会失败，这时由本地脚本补上）；
- 试合并到 `feat/mirasim`，看会不会冲突；
- 把结果写进一个固定的 **“Upstream updates” Issue**；没有新提交时自动关闭。

它**只报告，不往 `feat/mirasim` 推代码**。合并要在本地跑完测试再推。
注意：GitHub 会在仓库 60 天没有动静后自动停用定时工作流，到时去 Actions 页重新启用即可。

### 本地同步

```sh
scripts/sync-upstream.sh --check     # 看上游有哪些新提交；顺带检查 Antigravity 社区插件
scripts/sync-upstream.sh             # 镜像 main → 合并上游 → vet/test/race/插件测试 → 推送 feat/mirasim
scripts/sync-upstream.sh --install   # 再构建、安装“Magpie Mirasim.app”、打 tag 并推送
```

- 工作区必须干净，并且在 `feat/mirasim` 分支上。
- 合并冲突时脚本会停下：解决冲突、`git commit`，再运行一次同样的命令。
- `--install` 会先把旧的 App 打包到 `~/Library/Caches/magpie-mirasim/previous.zip`，方便回滚。
- 装好后可以用 `node scripts/verify-mirasim.mjs`、`node scripts/verify-cohub.mjs`、
  `node scripts/verify-subscriptions.mjs` 对运行中的网关（默认 `127.0.0.1:3425`）做真实验证，会消耗少量额度。

### 外部依赖的更新

- **Cohub CLI**：`npm i -g @neta-art/cohub-cli@latest`。插件每次启动都选本机最新的 CLI，不用改代码。
  如果 CLI 的 `dist/client.js` 或 `space.js` 接口变了，`plugins/cohub` 的测试和 `verify-cohub.mjs` 会报出来。
- **Antigravity 社区插件**：它经手 Google 登录凭据，所以**不自动更新**。`--check` 会显示它比钉住的版本新了几个提交；
  看过改动再按 `plugins/antigravity/README.md` 的步骤切换 commit、重新构建，并更新 README 里的钉版本号。

## 回滚

- 回到上一个定制版：解压 `~/Library/Caches/magpie-mirasim/previous.zip` 到 `/Applications`。
- 回到某个 tag：`git checkout mirasim-v0.1.550.1 && sh build/mirasim-app.sh`。
- 官方版 `/Applications/magpie.app` 一直保留，两者的配置目录 `~/.config/magpie` 是共用的。
