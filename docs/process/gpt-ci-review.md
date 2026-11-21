# GPT 独立复核（CI）

来源：#120。工作流 `.github/workflows/gpt-review.yml`，脚本 `scripts/gpt-review/`，评审提示词与输出 schema `.github/gpt-review/`。

**默认停用。** 合并本工作流不会启用任何东西：仓库变量 `GPT_REVIEW_ENABLED=true` 之前不运行。

## 为什么

- GPT（dot）的独立复核原本跑在维护者的 ChatGPT 对话里，GitHub 事件无法唤醒它（AGENTS §11），每次都要维护者传话；#119 曾因此停滞约 6 小时。
- 所有 agent 共用维护者 GitHub 账号，“所有者账号 + 执行者：GPT 前缀”认不出真正的评审者，也证明不了评审针对的是哪个提交（#119 GPT 复核）。

这里改为由事件触发：PR 有新提交、转 Ready 或手动触发时自动复核；结论用 GitHub App `mxgarage-vss-gpt` 的身份发评论（作者显示为 `mxgarage-vss-gpt[bot]`，其他 agent 用共享账号冒充不了），每条评论都带被评审的精确 head。

## 怎么运行

持有模型密钥与 App 私钥的入口，候选 PR 改不了：

- 触发用 `pull_request_target`：工作流定义取自 PR 的**目标分支**，且只评审目标为 `main`、来自本仓库分支的 PR。手动触发时 `prepare.sh` 在模型步骤之前再核对一次输入 PR 的目标是 `main`。候选 PR 里改过的 `gpt-review.yml` 不会被执行（用 `pull_request` 会执行候选里的定义，#120 GPT 复核 P1）。
- 手动触发只在从 `main` 运行时生效；`--ref` 选别的分支（那会用该分支里的定义）直接跳过。
- 两个任务都绑定环境 `gpt-review`，密钥只放在这个环境里，环境由维护者限制为只允许 `main`。
- 评论令牌只申请 `pull-requests: write`；所有查询用只读的 `GITHUB_TOKEN`。

```
PR 新提交 / 转 Ready / 手动（gh workflow run gpt-review.yml --ref main -f pr=<号>）
  review（只读令牌）
    1. 从 main 稀疏检出评审规则：提示词、schema、AGENTS / CONTRIBUTING / constitution（PR 不能改自己的评审规则）
    2. prepare.sh：在可信目录里写好提示词（只代入 PR 号、完整 head / base SHA 与固定路径）和上下文
       （PR 元数据与文件清单、关联 issue 正文与评论、完整翻页后整个 PR 最近 30 条评论、head 上的 CI 检查快照，全部标为数据；没取全的列表标 complete=false）
    3. 检出精确 head 到另一个目录，只作为被评审的数据
    4. Codex（openai/codex-action）以可信目录为工作目录、在只读沙箱里运行，按 schema 输出结论
  post（只用 App 令牌）
    （发布任务检出的规则与脚本固定为评审时解析出的 main SHA，main 在两个任务之间前进也不换规则）
    5. 核对 PR head 仍是被评审的提交（已变化就不发，新提交会触发新的评审）；真正写评论前再核对一次
    6. 去重：本 App 对同一 head 已有终局结论（pass / changes）就不再发；blocked / error 不算终局，阻塞解除后同一 head 可以重新发
    7. 校验输出符合 schema（不符合就发“评审输出无效”并让运行失败，不会显示成通过）
    8. 机器核对 pass：main 上登记的必需检查（.github/gpt-review/required-checks.txt，每行“检查名 App 工作流”，
       现为 gates github-actions .github/workflows/ci.yml）必须：由该 App 发出、挂在本 head 上、所属 Actions 运行
       是该工作流文件且就是本 head、检查确实属于该运行（check suite 一致，且运行里有指向这个 check run 的成功 job；
       details_url 是创建者自填的，不作为来源证明）、已完成且成功，且 PR 没有改动该工作流文件（完整翻页；未完成时最多等 25 分钟）。
       完整取到的每个提交都要有 Executor trailer，且不属于 GPT 体系（GPT / dot / codex）；缺署名算“无法核实”。
       模型给 pass 却列出 P1 / P2 时按 changes 处理。任何查询失败、结构不对或取不全都算“无法核实”。
       评论里记录 CI 测的是什么：pull_request 事件测 head 与 base 的临时合并提交，devloop 的手动触发测 head 本身。
       任一不满足，模型给的 pass 降为 blocked 并写明原因
    9. 渲染成评论发到 PR
```

评论格式：

```
执行者：GPT（CI 评审，mxgarage-vss-gpt）｜PR #N 独立复核
<!-- gpt-ci-review pr=N head=<完整 SHA> verdict=pass|changes|blocked run=<运行号> rules=<main SHA> -->
结论、摘要、按严重度（P1 / P2 / P3）排序的问题清单、已检查、未检查
```

- `pass`：没有 P1 / P2，且经机器核对必需检查全绿、实现者不属于评审者体系；模型只评代码与证据，CI 状态完全由发布阶段判定（上下文里的检查快照可能还没跑完）；`changes`：有 P1 / P2；`blocked`：无法完成评审（CI 未完成或失败、上下文缺失、触碰需要维护者决定的保留项）。
- 只发评论，不提交 GitHub 的“批准 / 请求修改”评审，不改分支保护里的必需评审人数。

devloop 用 `GITHUB_TOKEN` 开的 PR 不会触发 `pull_request` 事件（GitHub 规则），所以 devloop 开出 Draft PR 后会主动触发 `ci.yml` 与本工作流（`docs/DEVLOOP.md`）。触发失败时在 PR 上留言，写明手动命令。

## 维护者配置（保留项，agent 不代办）

1. 建环境 `gpt-review` 并限制为只允许 `main`（仓库 Settings → Environments → New environment → Deployment branches and tags 选 Selected branches，只加 `main`）。下面的密钥都存进这个环境，不存成仓库级 Secret。
2. OpenAI API key 存为环境 Secret（只粘到终端提示里）：`gh secret set OPENAI_API_KEY -R daniel-to-the-moon/van-sticker-studio --env gpt-review`。按 API 用量计费；建议在 OpenAI 后台给这个 key 设用量上限。
3. App 身份：
   - 在 `mxgarage-vss-gpt` 的 App 设置里确认权限至少有本仓库 **Pull requests: Read and write**（发 PR 评论用），并已安装到本仓库。
   - App ID 存为仓库变量：`gh variable set GPT_REVIEW_APP_ID -R daniel-to-the-moon/van-sticker-studio --body <App ID>`。
   - 在 App 设置页生成私钥（.pem），存为环境 Secret：`gh secret set GPT_REVIEW_APP_KEY -R daniel-to-the-moon/van-sticker-studio --env gpt-review < 私钥文件.pem`，之后删除本机的 .pem 文件。
4. 可选：`GPT_REVIEW_MODEL`（不设时用 codex-action 的默认模型）。
5. 启用：`gh variable set GPT_REVIEW_ENABLED -R daniel-to-the-moon/van-sticker-studio --body true`。
6. 第一次试跑：对一个小 PR 运行 `gh workflow run gpt-review.yml -R daniel-to-the-moon/van-sticker-studio --ref main -f pr=<号>`，看 PR 上是否出现 `mxgarage-vss-gpt[bot]` 的评论。

## 治理上的地位（待维护者决定）

本工作流只产出评审意见。它在 AGENTS 里算不算正式的“独立正向评审”、归哪个体系，由维护者决定并写进 roster，本 PR 不改 AGENTS、constitution 或 roster。建议的口径：

- 身份：`mxgarage-vss-gpt[bot]`，归 GPT、dot、codex 这一体系；
- 对 Claude、Muse、Grok 等其他体系实现的 PR，它是非本体系评审；对 GPT / codex 实现的 PR 不算独立评审；
- dot 在 ChatGPT 里仍负责派单、合并与验收决定，可以直接引用这条评论的结论与 head。

## 局限与风险

- **提示注入**：PR 的代码、说明文件、提交信息与评论都可能夹带指令。缓解：规则与提示词取自 main；工作目录是只含 main 规则的可信目录；上下文与 PR 检出都标为数据；Codex 只读沙箱；输出必须符合 schema，评论由可信脚本渲染（转义 HTML 注释、不提醒任何人）。仍不能完全排除模型被误导，结论是评审意见，不替代 dot 与维护者的决定。
- **API key**：review 任务持有 OpenAI API key；codex-action 默认的 `drop-sudo` 策略与只读沙箱限制 Codex 进程，但 key 仍可能因 action 或依赖被投毒而泄露。建议设用量上限，必要时轮换。
- **只读**：Codex 在只读沙箱里不能跑 `npm` 或测试，只能读代码与上下文里的 CI 结果；`not_checked` 会照实写出。
- **只记录，不接必需检查**：本工作流的结论不进分支保护的必需检查，也不恢复 devloop 的自动修复。
- **未在真实 Actions 里运行过**：本 PR 只有脚本行为测试与工作流结构测试；`working-directory`、`--skip-git-repo-check` 与 `:read-only` 的组合需要第一次试跑确认。
