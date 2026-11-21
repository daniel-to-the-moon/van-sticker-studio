# GPT 独立复核（CI）

来源：#120。工作流 `.github/workflows/gpt-review.yml`，脚本 `scripts/gpt-review/`，评审提示词与输出 schema `.github/gpt-review/`。

**默认停用。** 合并本工作流不会启用任何东西：仓库变量 `GPT_REVIEW_ENABLED=true` 之前不运行。

## 为什么

- GPT（dot）的独立复核原本跑在维护者的 ChatGPT 对话里，GitHub 事件无法唤醒它（AGENTS §11），每次都要维护者传话；#119 曾因此停滞约 6 小时。
- 所有 agent 共用维护者 GitHub 账号，“所有者账号 + 执行者：GPT 前缀”认不出真正的评审者，也证明不了评审针对的是哪个提交（#119 GPT 复核）。

这里改为由事件触发：PR 有新提交、转 Ready 或手动触发时自动复核；结论用 GitHub App `mxgarage-vss-gpt` 的身份发评论（作者显示为 `mxgarage-vss-gpt[bot]`，其他 agent 用共享账号冒充不了），每条评论都带被评审的精确 head。

## 怎么运行

```
PR 新提交 / 转 Ready / 手动（gh workflow run gpt-review.yml -f pr=<号>）
  review（只读令牌）
    1. 从 main 稀疏检出评审规则：提示词、schema、AGENTS / CONTRIBUTING / constitution（PR 不能改自己的评审规则）
    2. prepare.sh：在可信目录里写好提示词（只代入 PR 号、完整 head / base SHA 与固定路径）和上下文
       （PR 元数据与文件清单、关联 issue 正文与评论、最近 30 条 PR 评论、head 上的 CI 检查结果，全部标为数据）
    3. 检出精确 head 到另一个目录，只作为被评审的数据
    4. Codex（openai/codex-action）以可信目录为工作目录、在只读沙箱里运行，按 schema 输出结论
  post（只用 App 令牌）
    5. 核对 PR head 仍是被评审的提交（已变化就不发，新提交会触发新的评审）
    6. 校验输出符合 schema（不符合就发“评审输出无效”并标记失败），渲染成评论发到 PR
```

评论格式：

```
执行者：GPT（CI 评审，mxgarage-vss-gpt）｜PR #N 独立复核
<!-- gpt-ci-review pr=N head=<完整 SHA> verdict=pass|changes|blocked run=<运行号> rules=<main SHA> -->
结论、摘要、按严重度（P1 / P2 / P3）排序的问题清单、已检查、未检查
```

- `pass`：没有 P1 / P2，且 head 上的 CI 检查全绿；`changes`：有 P1 / P2；`blocked`：无法完成评审（CI 未完成或失败、上下文缺失、触碰需要维护者决定的保留项）。
- 只发评论，不提交 GitHub 的“批准 / 请求修改”评审，不改分支保护里的必需评审人数。

devloop 用 `GITHUB_TOKEN` 开的 PR 不会触发 `pull_request` 事件（GitHub 规则），所以 devloop 开出 Draft PR 后会主动触发 `ci.yml` 与本工作流（`docs/DEVLOOP.md`）。触发失败时在 PR 上留言，写明手动命令。

## 维护者配置（保留项，agent 不代办）

1. OpenAI API key 存为仓库 Secret（只粘到终端提示里）：`gh secret set OPENAI_API_KEY -R daniel-to-the-moon/van-sticker-studio`。按 API 用量计费；建议在 OpenAI 后台给这个 key 设用量上限。
2. App 身份：
   - 在 `mxgarage-vss-gpt` 的 App 设置里确认权限至少有本仓库 **Pull requests: Read and write**（发 PR 评论用），并已安装到本仓库。
   - App ID 存为仓库变量：`gh variable set GPT_REVIEW_APP_ID -R daniel-to-the-moon/van-sticker-studio --body <App ID>`。
   - 在 App 设置页生成私钥（.pem），存为 Secret：`gh secret set GPT_REVIEW_APP_KEY -R daniel-to-the-moon/van-sticker-studio < 私钥文件.pem`，之后删除本机的 .pem 文件。
3. 可选：`GPT_REVIEW_MODEL`（不设时用 codex-action 的默认模型）。
4. 启用：`gh variable set GPT_REVIEW_ENABLED -R daniel-to-the-moon/van-sticker-studio --body true`。
5. 第一次试跑：对一个小 PR 运行 `gh workflow run gpt-review.yml -R daniel-to-the-moon/van-sticker-studio -f pr=<号>`，看 PR 上是否出现 `mxgarage-vss-gpt[bot]` 的评论。

## 治理上的地位（待维护者决定）

本工作流只产出评审意见。它在 AGENTS 里算不算正式的“独立正向评审”、归哪个体系，由维护者决定并写进 roster，本 PR 不改 AGENTS、constitution 或 roster。建议的口径：

- 身份：`mxgarage-vss-gpt[bot]`，归 GPT、dot、codex 这一体系；
- 对 Claude、Muse、Grok 等其他体系实现的 PR，它是非本体系评审；对 GPT / codex 实现的 PR 不算独立评审；
- dot 在 ChatGPT 里仍负责派单、合并与验收决定，可以直接引用这条评论的结论与 head。

## 局限与风险

- **提示注入**：PR 的代码、说明文件、提交信息与评论都可能夹带指令。缓解：规则与提示词取自 main；工作目录是只含 main 规则的可信目录；上下文与 PR 检出都标为数据；Codex 只读沙箱；输出必须符合 schema，评论由可信脚本渲染（转义 HTML 注释、不提醒任何人）。仍不能完全排除模型被误导，结论是评审意见，不替代 dot 与维护者的决定。
- **API key**：review 任务持有 OpenAI API key；codex-action 默认的 `drop-sudo` 策略与只读沙箱限制 Codex 进程，但 key 仍可能因 action 或依赖被投毒而泄露。建议设用量上限，必要时轮换。
- **只读**：Codex 在只读沙箱里不能跑 `npm` 或测试，只能读代码与上下文里的 CI 结果；`not_checked` 会照实写出。
- **未在真实 Actions 里运行过**：本 PR 只有脚本行为测试与工作流结构测试；`working-directory`、`--skip-git-repo-check` 与 `:read-only` 的组合需要第一次试跑确认。
