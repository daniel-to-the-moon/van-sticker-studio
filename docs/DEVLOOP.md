# devloop：云端 Claude 开发主力

来源：[a2a-devloop](https://github.com/daniel-to-the-moon/a2a-devloop) 模板的“云端执行者”部分，按本仓库规则改编（#118）。规则以 main 上的 AGENTS.md / CONTRIBUTING.md 为准，本文只说明这套自动化怎么用。

**默认停用。** 合并本工作流不会启用任何东西：仓库变量 `DEVLOOP_ENABLED=true` 之前，打标签、评论、手动触发都不运行。

## 一、循环（当前接入范围）

```
维护者给 issue 打 devloop 标签（= 授权并 Ready）
        │
  【GitHub Actions】claude.yml（只运行 main 上 scripts/devloop 的可信脚本，除 work 外不执行仓库代码）
     preflight（issues: write）：确定模式与准确基线（完整 SHA）→ 取得全局锁 devloop-lock（实现与修复都要）→ 实现时另核对冲突、在 issue 发 claim；打 devloop-running
     work（只读令牌）：检出该基线 → Claude 改代码 + 测试 → 跑门禁 → 本地提交 → 上传前核对 → git bundle（不发布时保全为过滤后的 recovery.bundle）
     publish（写权限）：发布前二次核对（见第四节）→ 全部通过才推到 feature/<N>-claude-devloop → 开 Draft PR（Closes #N）→ 释放锁
        │
  评审与合并：照 AGENTS §8/§13，由非实现者独立评审；评审通过后转 Ready；dot 决定、非实现者合并
  需要修复：维护者 `gh workflow run claude.yml -f pr=<PR号>`，Claude 读最新一条“执行者：GPT”评审在同一分支修复
```

**未接入**：审核方 watch（本机或云端 Codex 自动审核、签名标记、自动合并）。接入前评审仍按现行流程手动进行，`DEVLOOP_REVIEWER` 保持关闭。

## 二、维护者配置（保留项，agent 不代办）

建议的试点顺序：先合并（停用状态），再按下面配置，最后开一个很小的 issue 打标签试跑。

1. 本机生成订阅令牌（会打开浏览器登录）：`claude setup-token`。
2. 存为仓库 Secret（令牌只粘到终端提示里，不要发到对话、issue 或 PR）：
   ```bash
   gh secret set CLAUDE_CODE_OAUTH_TOKEN -R daniel-to-the-moon/van-sticker-studio
   ```
   只用订阅时**不要**同时设 `ANTHROPIC_API_KEY`，否则改按 API 计费。
3. 允许 Actions 开 PR（publish 用 `GITHUB_TOKEN` 开 Draft PR 需要）：
   ```bash
   gh api -X PUT repos/daniel-to-the-moon/van-sticker-studio/actions/permissions/workflow \
     -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
   ```
   **范围说明**：这是仓库级设置，GitHub 把“创建 PR”和“批准 PR”放在同一个开关里，打开后本仓库任何声明了 `pull-requests: write` 的工作流都能开 PR 并提交批准评审，不只本工作流。本工作流从不提交批准；`GITHUB_TOKEN` 的批准按 GitHub 规则不计入必需评审人数（以 GitHub 当前行为为准，待核实）。不试点时可以关回去：把 `can_approve_pull_request_reviews` 改成 `false`，此时 publish 开 PR 会失败并加 `needs-user`，不会无声卡住。
4. 启用：`gh variable set DEVLOOP_ENABLED -R daniel-to-the-moon/van-sticker-studio --body true`。
5. 可选变量：`CLAUDE_MODEL`（不设时用 `claude-sonnet-5-5`）；排障时私有仓库可设 `CLAUDE_SHOW_FULL_OUTPUT=true`（公开仓库不要开）。
6. 标签 `devloop`、`needs-user`、`hold`、`devloop-running` 已建好。`devloop-lock` 是运行时由工作流自己创建、删除的锁标签，平时不存在，不要手动建。

## 三、怎么用

- **派活**：开一个 issue（一件事、可勾选的验收标准），由维护者打 `devloop` 标签。打上即触发、即视为授权；issue 正文就是冻结 spec。devloop 一次只做一项：上一项的 PR 合并或关闭、blocked 的项处理完之前，新打标签的 issue 会停下并加 `needs-user`，之后手动重跑即可。
- **看结果**：issue 上先出现 claim（含 run、完整 base SHA、正文 sha256），成功后开 **Draft** PR，分支 `feature/<N>-claude-devloop`，正文按 PR 模板写，每个提交带 `Executor: Claude（devloop 云端）` trailer。独立评审通过后由评审方转 Ready（§13 要求合并时非 Draft）。
- **停下等人**：开工前有冲突、Claude 判断命中停止条件、云端失败、发布前核对不通过时，在 issue / PR 留说明并加 `needs-user`。
- **重试**：失败不会自动重派。排除原因后由维护者手动触发——实现：`gh workflow run claude.yml -f issue=<号>`；修复：`gh workflow run claude.yml -f pr=<号>`。手动触发会放行带 `needs-user` 的 issue / PR，成功推送后自动去掉 `needs-user`；标签事件和评论事件不放行 `needs-user`。
- **暂停**：某个 issue / PR 打 `hold`（标签、评论、手动触发都不跑，运行中的任务在发布前也会停下）。全部暂停：`gh variable set DEVLOOP_PAUSED --body true`（恢复：删掉该变量）。彻底停用：删掉 `DEVLOOP_ENABLED`。

## 四、机器强制的核对（不靠提示词）

实现（implement）与修复（fix）走同一道闸门：都要取得全局锁、有效认领、冻结 spec、准确基线，都过同样的上传前与推送前核对。

**开工前（preflight / claim.sh）**，先取锁，再在锁内核对，任一命中就不开工（留说明、加 `needs-user`、释放锁）：

- 全局互斥锁：仓库标签 `devloop-lock`，创建是原子操作（已存在则失败），描述写持有者 `issue #N run <id>`；从开工前持有到发布结束，只由持有者释放。防止两次运行同时写代码。
- AGENTS §10 每人最多一个活动实现：devloop 在其他分支上还有开放 PR（等待评审 / 合并），或有其他 blocked 的实现（带 devloop claim 且 `needs-user` 的 issue），就不开新的。blocked 不释放名额，锁释放也不等于名额或文件锁可以交接；失败留证后不自动重派，由维护者处理后手动重跑同一项。
- 任务 issue 上有其他执行者的 claim（首行以“执行者：”开头、含 claim / 认领），按 §11 先发者为准。只有 Actions 发出、首行为“执行者：Claude（devloop 云端）”且带 devloop-claim 标记的评论算 devloop 自己的；正文引用该标记或冒用首行的都算他人。
- 实现另查：本任务已有开放 PR（`feature/<N>-*` 或 `fix/<N>-*`）；远端已有 `feature/<N>-claude-devloop` 分支（上次的成果，不覆盖）。
- 修复另查：任务 issue（取自分支名 `feature/<issue>-…-claude-devloop`）上必须有 devloop 的实现 claim，且 issue 正文的 sha256 与那次 claim 一致（spec 被改过就要重新认领，不在旧 PR 上修）；PR 上没有他人 claim。通过后在 PR 上发修订 claim（run、PR head、spec、所针对评审的哈希）。
- `devloop-running` 只是给人看的运行中标记。

**上传前（work 任务最后一步 / pack.sh）**：产物一离开 runner 就不受推送核对保护，所以先过同样的核对，只上传明确的文件（`outcome`、`body.md`、`title.txt`、`work.bundle`、`recovery.bundle`）：

- `work.bundle`：只在 outcome=pr 时产出，先过下面第 5、6 条的边界核对，并扫描提交内容里是否出现本任务的密钥值（订阅令牌、API key、`GITHUB_TOKEN`）；不通过就不打包、改为 needs-user。
- `recovery.bundle`：不发布但有改动时的恢复快照。只含批准范围内的净工作树（单个提交，不带中间历史；禁止路径与符号链接不纳入，说明里列出未纳入的路径名），也过密钥扫描；扫描命中就不上传，只报告状态。
- `body.md` / `title.txt`：含本任务密钥值就整份丢弃，只留状态说明。
- 扫描对象是 bundle 实际带出去的全部对象（提交信息、树、所有文件内容，含二进制与合并提交解决冲突时写入的内容）；内容先完整写入临时文件再比对，扫描出错一律按命中处理。局限：只比对本任务可见的这几个值，经过编码或变形的值认不出。

**推送前（publish.sh）**，任一不通过就不推送：

1. 开关：`DEVLOOP_ENABLED=true` 且未 `DEVLOOP_PAUSED`（在 publish 任务开始时求值）；
2. 实时状态：issue / PR 仍打开、无 `hold`、实现时仍带 `devloop`、修复时 PR 分支未变；
3. 认领：目标 issue / PR 上有本次 run 由 Actions 发出的 claim，issue 与 PR 上之后都没有他人 claim；任务 issue 正文的 sha256 与 claim 时一致；
4. 准确基线：实现时 main 仍是 claim 里的 base（main 前进就停，不在发布阶段 rebase，受测树就是推送树），目标分支不存在；修复时分支 head 仍是开工时的 SHA；
5. 文件边界：相对 main 的净改动，**以及每一个待推送的提交**（中间提交加入又删除的文件也会随历史推上去；合并提交只看它自己引入的改动；路径按 NUL 分隔的原始字节匹配，非 ASCII、空格、换行都不会因转义漏判）都不碰禁止路径（`scripts/devloop/lib.sh`：GLB 与 `public/model/`、`dist/`、`.github/`、`.openai/`、`.env*`、`.dev.vars*`、`package.json` / `package-lock.json`、constitution / AGENTS / CLAUDE、`.claude/`、`scripts/devloop/`、`wrangler.*`），任何待推送提交都不新增符号链接；每个待推送的提交（含合并提交）都带 `Executor: Claude（devloop 云端）`；
6. 修复的冻结文件范围：只能改 PR 在开工时已改动的文件，以及 `tests/`、`docs/` 与 `*.test.*`；越界要维护者重新认领。

## 五、Claude 不写代码、直接 needs-user 的情况

收费 / 广告 / 对公众上线；需要新的付费服务或账号；需求互相矛盾或信息不足；以及本仓库硬边界：改 GLB 或其元数据与哈希、品牌字样或 GLB 节点重命名、读写 `.openai/`、`.dev.vars*`、`.env*`、写出密钥、新增或升级依赖、改 `dist/`、改 `.github/workflows/`、改 constitution 或 AGENTS 的决策权与保留项、上线或改平台设置。其中能按路径判断的，第四节在发布前再机器核对一次。

## 六、额度、权限与风险

- **额度**：订阅令牌与维护者在 claude.ai、Claude Code 的日常使用共用同一份额度（五小时会话上限 + 每周上限）。额度用完时云端 Claude 会很快失败并加 `needs-user`，等额度重置后手动重跑。全局锁也意味着同一时间只消耗一份。
- **令牌**：`work` 任务执行仓库代码且持有模型令牌；依赖被投毒时可能泄露该令牌（拿不到写仓库令牌）。可随时在本机重新 `claude setup-token` 并覆盖 Secret（旧令牌是否立即失效以 Anthropic 当前行为为准，待核实）。
- **最低权限**：`work` 只有 `contents / issues / pull-requests / actions: read`，没有 `id-token`——传入 `github_token` 时 claude-code-action 直接使用它，不做 OIDC 交换（固定版本 `acfe799` 的 `src/github/token.ts` 中 `setupGitHubToken` 遇到 `OVERRIDE_GITHUB_TOKEN` 直接返回）。`preflight` 只有 `issues: write`，`publish` 有 `contents / pull-requests / issues: write`，二者都只运行 main 上的脚本。
- **依赖固定**：工作流里的第三方 action 都固定到完整提交 SHA（注释写对应标签）；升级时改 SHA 并重新评审。
- **共享账号**：所有 agent 目前共用维护者 GitHub 账号，谁都能打 `devloop` 标签、设变量；“打标签 = 维护者授权”靠约定，不是技术约束。
- **卡住的锁**：运行被手动取消时 publish 不运行，`devloop-lock` 可能残留，之后所有实现都会停下并在说明里写出持有者。确认那次运行已结束后：`gh label delete devloop-lock -R daniel-to-the-moon/van-sticker-studio --yes`，并去掉对应 issue 的 `devloop-running`。
- **门禁**：Claude 在云端用 `npm ci --ignore-scripts` 装依赖；若某项门禁因此跑不了，PR 里会写明，以 PR 上的 `gates` CI 为准。

## 七、文件

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/claude.yml` | `preflight` + `work` + `publish`；`workflow_dispatch` 可按 `pr` 或 `issue` 手动重跑 |
| `scripts/devloop/ctx.sh` | 判断模式（implement / fix）、分支与准确基线；只修本仓库 `feature/*-claude-devloop` 分支 |
| `scripts/devloop/claim.sh` | 开工前取得全局锁、§10 占用与冲突核对、发 claim（实现与修复） |
| `scripts/devloop/pack.sh` | work 结束时决定 outcome；上传前核对与密钥扫描；打包要发布的提交，不发布时保全过滤后的成果 |
| `scripts/devloop/publish.sh` | 发布前二次核对，通过后推送、开 Draft PR 或评论；不执行仓库代码 |
| `scripts/devloop/lib.sh` | 共享判断：他人 / 本 run claim、spec 哈希、禁止路径与边界核对、修复范围、全局锁 |
| `scripts/devloop/install-bun.sh` | 带重试安装 Bun，避开 action 内置下载的偶发失败 |
| `scripts/devloop/claude.test.mjs` | 上述脚本的行为测试（假 gh + 真 git），以及读取真实 `claude.yml` 求值触发条件、核对权限与版本固定的测试；已加入 `npm test` |
