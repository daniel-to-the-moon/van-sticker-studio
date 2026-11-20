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
4. **视觉**：改了可见文件时，需要维护者在**当前 head 推送之后**（按仓库活动记录的推送时间，不看提交里自带的日期）打的 `visual-accepted`，或 e2e 工作流（`github-actions[bot]`）在那之后打的 `no-visual-change`。agent 打的 `visual-accepted` 不算。
5. **fork PR 一律不放行**：推送者身份核实不了。所有列表接口都翻完全部分页再判定。

PR 推送、标签变化、评审提交/撤回时自动重算；也可以在 PR 评论 `/gate` 触发。

## 维护者一次性配置（脚本，一条命令）

GitHub 没有直接创建 App 的 API，唯一的程序化途径是 manifest 流程，每个 App 需要在浏览器里确认一次。`tools/bootstrap-github.mjs` 把其余步骤都交给 GitHub CLI，在本机运行（需要已 `gh auth login` 为仓库管理员）：

```bash
node tools/bootstrap-github.mjs --repo daniel-to-the-moon/van-sticker-studio \
  --prefix mxgarage-vss --systems gpt,muse,grok --existing gpt,muse,grok
```

- **App**：自动打开本地页面，对每个还没建的 App（这里只剩 `mxgarage-vss-gate`）依次跳到 GitHub：点 **Create GitHub App** → 自动到安装页，只选本仓库点 **Install** → 自动回来进行下一个。私钥保存到 `~/.config/agent-apps/<slug>.pem`（权限 600），不打印。
- **仓库**：建标签；建 Environment `independence-gate`（只允许默认分支部署）并写入 `GATE_APP_ID`、`GATE_APP_PRIVATE_KEY`；把实际 App slug 写进 `.github/agent-identities.json`（请用 PR 提交）；建或更新规则集 `agent-governance`（禁删除与强推、要求 PR、必需检查 `gates`，管理员可绕过）。
- **闸门变为必需**：合并后在任一 PR 评论 `/gate`，等它产出一次检查，再运行一次：

```bash
node tools/bootstrap-github.mjs --repo daniel-to-the-moon/van-sticker-studio \
  --prefix mxgarage-vss --systems gpt,muse,grok --existing gpt,muse,grok --repo-only --require-gate
```

  GitHub 只允许把必需检查绑定到已经上报过该检查的 App，所以要分两次。
- 其余：`e2e`、`pr-hygiene` 等对应 PR 合并、产出检查后，再在规则集里加为必需；各 agent 平台换成自己的 App 私钥后，吊销它们手里的维护者个人令牌。
- 新项目同样用这条命令，`--existing` 写已经建过的 App，脚本只把新仓库配置好（App 的安装范围仍需在 App 设置页把新仓库加进去）。

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
- 仓库活动记录只保留近 90 天；存活超过 90 天的分支可能漏算早期推送者。超长寿命的分支请重开 PR。
- `no-visual-change` 由 e2e 工作流用 `GITHUB_TOKEN` 打；同仓库 PR 里的工作流理论上也能以 `github-actions[bot]` 身份打这个标签。需要更严时，改为仅接受维护者打的 `visual-accepted`。
