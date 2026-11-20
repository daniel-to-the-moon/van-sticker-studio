# Agent 身份与独立性闸门（方案 B，#114）

所有 agent 以前共用 `daniel-to-the-moon`，谁做了什么只能看署名。现在每个体系一个 GitHub App，独立性由 `independence-gate` 检查按 GitHub 身份判定。

## 身份

| 体系 | 成员 | GitHub 身份 |
| --- | --- | --- |
| gpt | GPT、dot、codex | `mxgarage-vss-gpt[bot]` |
| muse | Muse、Pubby | `mxgarage-vss-muse[bot]` |
| grok | Grok、Clara | `mxgarage-vss-grok[bot]` |
| claude | Claude | 经维护者的 GitHub 连接操作时，身份就是维护者 |
| maintainer | 盛俊 | `daniel-to-the-moon`（只由本人使用） |
| 闸门 | — | `mxgarage-vss-gate[bot]`，只发 `independence-gate` 检查 |

映射在 `.github/agent-identities.json`，改它属维护者保留项。

## 闸门怎么判

`independence-gate` 在每个 PR 的 head 上给出通过/未通过：

1. **实现方体系** = PR 作者 + 推送到该分支的所有身份（取自仓库活动记录，不能伪造）+ 提交里声明的作者（只会让实现方变多，所以伪造无益）。作者或推送者不在映射里 → 未通过。
2. **独立批准**：至少一个对**当前 head** 的 APPROVED 评审，来自不属于实现方的体系，或来自维护者。旧 head 上的批准不算。
3. **无阻断**：任何评审者最近一次评审是“要求修改” → 未通过。
4. **视觉**：改了可见文件时，需要维护者在最新提交之后打的 `visual-accepted`，或 e2e 工作流（`github-actions[bot]`）在最新提交之后打的 `no-visual-change`。agent 打的 `visual-accepted` 不算。

PR 推送、标签变化、评审提交/撤回时自动重算；也可以在 PR 评论 `/gate` 触发。

## 维护者一次性配置

1. **建第 4 个 App** `mxgarage-vss-gate`：用 `vss-github-apps.html` 里的第 4 张卡（权限只有 Checks/Commit statuses 写、Contents/Pull requests/Issues 读）。生成私钥，安装到本仓库。
2. **Environment**：Settings → Environments → New environment `independence-gate` → Deployment branches 选 *Selected branches*，只加 `main` → 加两个 secret：`GATE_APP_ID`（App ID）、`GATE_APP_PRIVATE_KEY`（整个 .pem 内容）。只限 main 是关键：PR 分支上的工作流拿不到这把私钥。
3. **规则集**：Settings → Rules → Rulesets → New branch ruleset，目标 `main`：
   - Restrict deletions、Block force pushes
   - Require a pull request before merging（Required approvals 可设 0，独立性由闸门判）
   - Require status checks to pass：添加 `gates`、`e2e`、`pr-hygiene`、`independence-gate`；把 `independence-gate` 的来源选为 `mxgarage-vss-gate`（GitHub 要求该 App 先在仓库里发过一次检查，所以先合并本 PR、等它在任一 PR 上跑一次再来选）
   - Bypass list 只留你本人（紧急时用）
4. **吊销旧令牌**：各 agent 平台换成自己的 App 私钥并验证能推送后，吊销 agent 手里所有 `daniel-to-the-moon` 的个人令牌。

## Agent 平台怎么用 App

每个平台保存自己体系的 App ID 与私钥，每次工作前换一个 1 小时有效的安装令牌：

```bash
# 用 App 私钥签 JWT，换安装令牌（任意语言的 GitHub App SDK 都有现成方法，例如 octokit 的 createAppAuth）
# git 推送：
git remote set-url origin https://x-access-token:${TOKEN}@github.com/daniel-to-the-moon/van-sticker-studio.git
# gh / REST：
GH_TOKEN=$TOKEN gh api repos/daniel-to-the-moon/van-sticker-studio/pulls ...
```

提交身份建议设成 App 的 bot 身份，便于在 GitHub 上看清归属（闸门不依赖它）：

```bash
id=$(GH_TOKEN=$TOKEN gh api "users/mxgarage-vss-gpt%5Bbot%5D" --jq .id)
git config user.name "mxgarage-vss-gpt[bot]"
git config user.email "${id}+mxgarage-vss-gpt[bot]@users.noreply.github.com"
```

评审用 App 身份提交 `APPROVE` 或 `REQUEST_CHANGES`（REST：`POST /repos/{owner}/{repo}/pulls/{n}/reviews`，`commit_id` 填当前 head）。正文仍按 AGENTS §8 写 path:line、结论和检查范围。

## 局限

- 维护者账号的权力最大：用它推送等于维护者亲自实现，批准等于维护者批准。所以它只能由本人使用。
- 仓库活动记录只保留近 90 天、单页 100 条；极长的 PR 可能漏算早期推送者（只会让闸门更宽松）。超长 PR 请拆分。
- `no-visual-change` 由 e2e 工作流用 `GITHUB_TOKEN` 打；同仓库 PR 里的工作流理论上也能以 `github-actions[bot]` 身份打这个标签。需要更严时，改为仅接受维护者打的 `visual-accepted`。
