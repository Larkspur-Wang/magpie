# Mirasim + Magpie 配置交接说明

这份文档描述当前这台 macOS 机器上的实现方式，目标是让另一个 coding agent 能复现、维护或继续开发，而不是把本机凭据复制给别人。

## 目标

- 用 Mirasim 原生的 `mirasim claude` 处理签名、登录和平台转发。
- 用 Magpie 作为本机模型网关、统一模型目录、路由池和用量账本。
- 在 Mirasim UI 中选择 Magpie 的模型或路由组。
- 不替换全局 `claude`，不复制 OAuth/token，不导入 CC Switch。

## 实际架构

### Claude Code 经 Mirasim + Magpie

正常的 B 链路是：

```text
Mirasim UI / magpie-mirasim launch claude
  -> 外层 Claude Code
  -> Magpie gateway: 127.0.0.1:3425
  -> group/<name>
  -> Mirasim provider
  -> Magpie 启动的原生 mirasim claude 子进程
  -> Mirasim 签名代理/平台
```

关键点：

1. Mirasim 原生 CLI 才负责请求签名和认证；不要用普通 bearer-token HTTP bridge 冒充它。
2. Magpie 启动内层 `mirasim claude` 时会清理 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`CLAUDECODE` 等环境变量，避免内层再回到 Magpie 形成递归。
3. Magpie 记录经过网关的模型、实际 provider/model、tokens、cache、耗时和状态；直接运行原生 `mirasim claude` 的历史流量不会自动导入。
4. Magpie 读取 Mirasim 原生 quota/status，用于显示窗口和额度感知路由；桌面 Mirasim host 必须运行，默认本地端口为 `4970`。
5. `magpie-mirasim` 是定制版 CLI；实现时不要把“官方版 `magpie`”和定制版的运行状态混在一起。

### Relay 的实现步骤

如果另一个 agent 要重新实现这条 relay，不要实现一个独立的 HTTP bearer-token 转发器。正确做法是把原生 Mirasim CLI 当作签名 relay 的子进程：

1. **解析当前 Mirasim runtime**：调用 `internal/mirasim.Resolve()`，从当前桌面 App 的 `state.json` 找到可用 runtime。不要固定旧版本路径。
2. **发现模型**：调用原生 `mirasim ui-cli catalog --agent claude`，把结果保存为 Magpie 的 `mirasim` live catalog。只暴露原生 CLI 报告的模型。
3. **注册 provider**：`internal/provider/mirasim.go` 在 `settings.Mirasim == true` 且 runtime 可解析时注册 `mirasim` provider；runtime 不存在时必须报错，不能静默降级到普通 Claude。
4. **处理网关请求**：`internal/gateway/mirasim.go` 通过现有 `subscription.startCommand` 启动：

   ```text
   resolved Mirasim binary
     + mirasim claude
     + canonical model id, 必要时加 [1m]
     + stream-json / MCP bridge
   ```

   不能直接调用未经签名的 relay HTTP endpoint。
5. **防递归**：启动内层 CLI 前调用 `cleanClaudeEnv(os.Environ())`，移除外层 Magpie 注入的 `ANTHROPIC_*`、`CLAUDECODE` 等变量，再加入 `MIRASIM_QUIET=1`。否则内层 Claude 可能重新指向 `127.0.0.1:3425`。
6. **保持会话**：provider owner 使用 provider 与本地账号的稳定标识，复用现有 `subscription.resume`；失败时 retire 旧会话后重新启动，保证流式输出、工具调用和 session continuation 不被拆坏。
7. **接入启动器**：`mirasim_cli.go` 提供 `mirasim on/off/sync` 和 `launch claude`；`internal/agent`、`internal/sessions` 让新会话和 resume 都执行当前 resolved runtime 的 `mirasim claude`。不能覆盖 PATH 中的全局 `claude`。
8. **接额度**：通过原生 `mirasim ui-cli --port 4970 relay status` 读取套餐、5 小时/周窗口和重置时间。不要读取或复制 Mirasim access token，也不要用 Magpie token 统计冒充平台余额。

最小实现检查点：

```text
catalog       原生 CLI 能列出模型
generation    经过 127.0.0.1:3425 能真实生成
stream        stream-json 首字和结束事件完整
tools         MCP/function tool 往返完整
recursion     内层 CLI 不再命中 3425
usage         Magpie ledger 有 served provider/model 和 token
quota         原生 status 能读到窗口；失败时不编造余额
```

具体代码入口是 `internal/mirasim/`、`internal/provider/mirasim*.go`、`internal/gateway/mirasim.go`、`internal/agent/`、`internal/sessions/` 和 `mirasim_cli.go`。这些步骤才是“把 Mirasim Claude 接成 Magpie relay”；仅添加一个 `mirasim` provider URL、能列模型，不算完成。

## 当前开关和启动方式

当前设置应为：

```text
Mirasim provider: true
Claude launcher: mirasim claude
Magpie gateway: 127.0.0.1:3425
```

检查：

```sh
magpie-mirasim mirasim
magpie-mirasim providers
magpie-mirasim groups
magpie-mirasim quota mirasim --json
```

开启并刷新 Mirasim 模型目录：

```sh
magpie-mirasim mirasim sync
magpie-mirasim mirasim on
```

启动 Claude Code：

```sh
magpie-mirasim launch claude
```

如果需要显式选组：

```sh
magpie-mirasim launch claude --model group/claude-opus-5-5
```

也可以在 Mirasim UI 的模型管理/模型选择中选已经同步的 `group/...` 模型。Mirasim UI 中的 Magpie 本地供应商使用 OpenAI-compatible 地址：

```text
Base URL: http://127.0.0.1:3425/v1
Key: 本机占位值，例如 magpie
```

该网关只监听 `127.0.0.1`，不要把这个地址直接暴露到局域网或公网；当前本地网关鉴权不能当作边界安全措施。

## 当前 provider

已接入并在 Magpie 中可见的来源：

| provider | 作用 | 备注 |
|---|---|---|
| `mirasim` | Mirasim 原生 CLI 模型 | 由定制版核心实现，不是普通插件；需要 Mirasim runtime |
| `codex` | 本地 Codex/ChatGPT 订阅 | 由 Codex 登录态提供 |
| `cursor` | Cursor 订阅模型 | 使用 Cursor 本地登录态，模型必须使用 Magpie catalog 的精确 ID |
| `grok` | Grok Build/SuperGrok 来源 | `grok-4.6:high` 是带 effort 的精确成员 |
| `google-plugin` | Antigravity 社区插件 | 使用现有 Google 登录，不复制凭据；插件版本固定并需人工审查更新 |
| `cohub` | Cohub CLI | 仅文本兼容；工具调用请求应拒绝，不能作为 coding-agent 工具链的可靠兜底 |
| `workbuddy` | 国内 WorkBuddy | 国际版 WorkBuddy AI 已移除，不要自动恢复 |

CC Switch 没有导入。任何 agent 的默认模型也不能因为“导入 provider”而被静默修改。

## 当前显式路由组

显式组均为 `routing=order`：从左到右依次尝试，前一个失败才进入下一个。组内的 `:text` Cohub 成员只适合无工具请求。

```text
group/claude-opus-5-5
  mirasim/claude-opus-5-5
  cursor/claude-opus-5-5
  cohub/claude-opus-5-5:text

group/claude-sonnet-5-5
  mirasim/claude-sonnet-5-5
  cohub/claude-sonnet-5-5:text

group/claude-fable-5-1
  mirasim/claude-fable-5-1
  cohub/claude-fable-5-1:text

group/gpt-6-astra
  codex/gpt-6-astra
  cohub/gpt-5.6-sol:text

group/gpt-sol
  codex/gpt-6.1-sol
  codex/gpt-6-sol
  cursor/gpt-5.6-sol
  cohub/gpt-5.6-sol:text

group/gemini
  google-plugin/gemini-3.8-flash
  cohub/gemini-3.8-flash:text

group/grok
  cursor/cursor-grok-4.6:high
  cursor/grok-4.7
  grok/grok-4.6:high
  grok/grok-4.7
  cohub/grok-4.6:text

group/kimi-k3
  mirasim/kimi-k3
  cohub/kimi-k3:text

group/deepseek-v4-flash
  mirasim/deepseek-flash
  cohub/deepseek-v4-flash:text

group/glm-5-3-flash
  mirasim/glm-5.3-flash
  cohub/glm-5.3-flash:text
```

已知边界：`mirasim/deepseek-flash` 在本机曾出现长时间无响应/超时，因此该成员按用户决定暂时保留；不要把它报告成“已稳定可用”。

## `auto-*` 组和显式组的区别

Magpie 还会根据同名模型自动生成 `group/auto-*` 组。这些组通常是 `routing=smart`，可能按额度/可用性选择来源，例如 `group/auto-claude-opus-5-5` 或 `group/auto-gpt-5-6-sol`。

它们不会改变显式组的顺序。选 `group/gpt-sol` 时，只会按上面的 `gpt-sol` 成员顺序走；只有请求方明确选择 `group/auto-...`，或 agent 默认被设置成该自动组，smart 路由才会参与。

诊断时必须记录三个字段：

```text
requested model   请求方选择的模型/组
served provider   实际命中的 provider
served model      实际命中的模型
```

不要仅凭 Mirasim 后台任务或 `memory_consolidation` 的模型名判断用户请求走了哪个组；那可能是 Codex 的后台记忆整理任务。

## Mirasim 核心实现位置

仓库中的核心修改不适合完全做成 provider plugin，原因是插件协议没有 agent 启动器和 Claude session resume hook，且 Mirasim 签名只能由原生 CLI 进程完成。

主要位置：

```text
internal/mirasim/                 运行时解析、catalog、quota、native CLI
internal/provider/mirasim*.go     provider、模型目录、测试和 quota
internal/gateway/mirasim.go       通过原生 mirasim claude 处理网关请求
internal/agent/                   Claude launcher 与设置接入点
internal/sessions/                会话恢复走 Mirasim launcher
mirasim_cli.go                    mirasim on/off/sync、launch claude
```

供应商插件优先放在：

```text
plugins/cohub/                    Cohub text-only provider
plugins/antigravity/              Antigravity community adapter + quota
```

## fork 和上游维护

```text
origin   https://github.com/Larkspur-Wang/magpie.git
upstream https://github.com/yetone/magpie.git
产品分支 feat/mirasim
main     上游 main 的纯镜像
```

`upstream` push URL 已禁用。吸收上游使用 merge，不 rebase、不 force-push：

```sh
cd /Users/lark/Playground/magpie
scripts/sync-upstream.sh --check
scripts/sync-upstream.sh
scripts/sync-upstream.sh --install
```

脚本会：

1. fetch `upstream` 和 `origin`；
2. 将 `main` 保持为上游镜像；
3. 把上游 merge 到 `feat/mirasim`；
4. 运行 `go vet`、Go tests、race、插件 tests 和纯终端构建；
5. 推送 fork；
6. `--install` 时构建并安装 `/Applications/Magpie Mirasim.app`，并创建 `mirasim-<upstream-tag>.<n>` tag。

定制版使用非正式版本号/独立 bundle 标识，防止官方自动更新器把它覆盖。官方 `/Applications/magpie.app` 应保留作为回滚版本。Antigravity 社区插件使用固定 commit，不要无人审查自动升级。

## 验证清单

```sh
cd /Users/lark/Playground/magpie

# 静态/专项
go vet ./...
go test ./...
go test -race ./internal/gateway/ ./internal/redact/
node --test plugins/*/*.test.mjs

# 原生 Mirasim catalog、真实生成、工具链
node scripts/verify-mirasim.mjs

# Cohub text-only 行为和额度
node scripts/verify-cohub.mjs

# 已登录订阅的真实请求（会消耗少量额度）
node scripts/verify-subscriptions.mjs google-plugin/gemini-3.8-flash

# 观察真实路由，而不是只看 model picker
magpie-mirasim usage --csv today
magpie-mirasim quota mirasim --json
magpie-mirasim groups
```

验收必须区分：

- provider/model catalog 能列出；
- 单 provider 请求真实返回；
- group 请求真实返回且记录 served provider/model；
- 工具调用、流式、长会话和降级分别验证；
- Mirasim 原生直接流量与经过 Magpie 的账本分开统计。

不要把“模型出现在列表里”、HTTP 200 的探测、静态测试全绿或历史验证报告当作当前完整接通的证明。

## 不要做的事

- 不读取、复制或打印 `~/.codex/auth.json`、Mirasim device token、keychain 或 provider token。
- 不覆盖全局 `claude` 可执行文件。
- 不把 Cohub 的 `:text` 模型加入需要工具调用的自动组，除非明确接受工具请求会 400。
- 不把不同 provider 的额度百分比相加成一个虚构余额。
- 不因上游更新直接覆盖定制版；先跑同步脚本和验证，再安装。
- 不因为 `memory_consolidation`、`thread_title` 等后台 Codex 请求出现别的模型，就认为显式 Magpie group 被 smart 路由改写。
