# 发版流程：版本可查 → 自动冒烟 → 验收标签 → 自动上线 / 自动回滚

> 切流量能力来自维护者配置的 Cloudflare 令牌和仓库变量 `AUTO_DEPLOY`，不来自本文。没配或关掉时，流程停在“版本已上传、冒烟有结果”，上线由维护者手动触发。

## 为什么要改

2026-11 的事实（见 [#100](https://github.com/daniel-to-the-moon/van-sticker-studio/issues/100) 日报）：

- Workers Builds 每次推 main 都会**上传一个版本**并给出预览 URL（例如 main `d9a719f` → Version `9b1eabf7`），但**不会切生产流量**。生产最后一次已知切换是 2026-10-26 的 `39a469bf`（对应 `20aee5d`），之后 13 个产品 PR 合入 main，都没上线。
- `/model-lab` 在生产 404、在 main 版本预览 200，就是这个版本差。
- 没人能只读查到“生产到底跑的是哪个 commit”，这个问题在日报里挂了 10 天。

## 流程

| 步 | 做什么 | 谁 | 产物 |
| --- | --- | --- | --- |
| 1 | 构建把 commit/分支/构建时间烘进产物，`GET /api/version` 可读 | 自动（`lib/build-info.ts`） | 任意版本 URL 上的 JSON |
| 2 | main 上 Workers Builds 成功 → 对该版本预览跑只读冒烟，并记录生产当前版本 | 自动（`release-acceptance.yml` 的 smoke） | Job Summary + 90 天 artifact |
| 3 | PR 合并前：关键路径 e2e 与前后截图对比在 CI 里跑（见 `e2e/`） | 自动 | PR 检查 + 截图 artifact |
| 4 | 改了可见文件的 PR 打标签：体验官看过截图后打 `visual-accepted`；评审确认没有可见变化的打 `no-visual-change` | 体验官 / 评审者 | PR 标签 |
| 5 | 发布闸门：目标是当前 main head、`gates` 绿、生产 commit 可读、区间内每个可见 PR 都有第 4 步标签 | 自动（`tools/production-deploy.mjs gate`） | 闸门报告 |
| 6 | 闸门通过 → 100% 切到该版本 → 生产冒烟（`--expect-commit` 必须等于目标） | 自动（`AUTO_DEPLOY=true` 时） | 发布记录 issue 评论 |
| 7 | 生产冒烟失败 → **一次性**切回切换前的版本 → 再冒烟 → 任务标红，等人工核实 | 自动 | 同上 |

闸门拦下时什么都不切，只在发布记录 issue 留一条“拦下原因”。补上标签后，下一次 main 构建会重试；也可以手动触发。

## 维护者一次性配置（agent 做不了）

1. Cloudflare 建一个只含 **Workers Scripts: Edit** 的 API 令牌。
2. GitHub 仓库 Settings → Secrets and variables → Actions：
   - Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
   - Variables：`AUTO_DEPLOY` = `true`（随时改成别的值即关闭自动上线）；可选 `RELEASE_LOG_ISSUE`（默认 107）
3. 可选：Settings → Environments 建 `production`，加 Required reviewers，则每次切流量前要人点批准。注意所有 agent 共用一个 GitHub 账号时，这个批准拦不住 agent。
4. 建议：分支保护要求 `gates` 与 `e2e` 通过才能合并。

## 第一次上线（手动）

现在生产早于 `/api/version`，闸门读不到生产 commit，第一次只能手动：

1. 合并 #108，等 main 的 Workers Builds 完成，从检查摘要拿 Version ID。
2. Actions → **Release acceptance** → Run workflow：`url` 填该版本的 Preview URL，`expect_commit` 填完整 main commit，勾选 `promote`，`promote_version` 填 Version ID。
3. 工作流会先冒烟预览，再切生产、冒烟生产，失败自动切回。之后的 main 构建就能走自动闸门。

手动触发跳过标签闸门，按维护者决定处理；其余检查不变。

## 手动跑冒烟

```bash
node tools/release-acceptance.mjs --url https://<版本前缀>-mxgarage-wrap-studio.haburaaashi.workers.dev --expect-commit <commit>
node tools/release-acceptance.mjs --url https://mxgarage-wrap-studio.haburaaashi.workers.dev --expect-commit <commit>
```

检查项：`/`、`/design`、`/body-lab`、`/model-lab` 均 200；`/api/status` 返回布尔 `configured`；`/api/version` 的 commit 与期望一致；线上 GLB 的 sha256 与该 commit 的 `public/model/motion_metadata.json` `glbSha256` 一致。只做 GET，不调用真实生成。

## GPT 验收的独立性

按 AGENTS 的体系划分，GPT、dot、codex 为同一体系：GPT 可以对 Claude、Grok、Muse 等实现的 PR 给独立结论；GPT/Codex 实现的 PR 由其它体系给结论。drawing 视觉结论归体验官，体现为 `visual-accepted` 标签。

## 手动命令（仅供已授权操作者）

```bash
npx wrangler deployments status --name mxgarage-wrap-studio
npx wrangler versions deploy <版本ID>@100% --name mxgarage-wrap-studio -y
```
