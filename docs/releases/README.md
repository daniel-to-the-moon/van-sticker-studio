# 发版流程：版本可查 → 自动冒烟 → GPT 验收 → 维护者切流量

> 本文是流程说明，不创建任何平台权限，也不执行生产操作。上线/切流量仍按 constitution 与 AGENTS §0、§13–14：由维护者本人确认，或由其另行授权的操作者执行。

## 为什么要改

2026-11 的事实（见 [#100](https://github.com/daniel-to-the-moon/van-sticker-studio/issues/100) 日报）：

- Workers Builds 每次推 main 都会**上传一个版本**并给出预览 URL（例如 main `d9a719f` → Version `9b1eabf7`），但**不会切生产流量**。生产最后一次已知切换是 2026-10-26 的 `39a469bf`（对应 `20aee5d`），之后 13 个产品 PR 合入 main，都没上线。
- `/model-lab` 在生产 404、在 main 版本预览 200，就是这个版本差：页面在 #88 合入，但生产版本早于 #88。
- 没人能只读查到“生产到底跑的是哪个 commit”，所以这个问题在日报里挂了 10 天，一直写成“等发布负责人核对”。

## 新流程

| 步 | 做什么 | 谁 | 产物 |
| --- | --- | --- | --- |
| 1 | 每个构建把 commit/分支/构建时间烘进产物，`GET /api/version` 可读 | 自动（`lib/build-info.ts`、`vite.config.ts`） | 任意版本 URL 上的 JSON |
| 2 | Workers Builds 构建成功 → 自动对该版本预览跑只读冒烟，并顺带记录生产当前版本 | 自动（`.github/workflows/release-acceptance.yml`） | Actions Job Summary + 90 天 artifact |
| 3 | 写发版记录：当前生产版本、目标版本、包含的 PR、回滚目标 | 实现者或 dot | `docs/releases/<日期>-rcN.md` |
| 4 | 按发版记录的清单在**目标版本预览 URL** 上做关键路径验收，逐项贴证据 | GPT（见下方独立性） | 发版 PR/Issue 下一条验收评论 |
| 5 | 体验官 drawing 目检（AGENTS §3，GPT 不代替） | 体验官；无人时按 §15 由用户指定 | 同视角截图与结论 |
| 6 | 切流量：`wrangler versions deploy <目标版本ID>@100%` | 维护者本人或其授权操作者 | Cloudflare 部署记录 |
| 7 | 切后立刻对生产跑冒烟，`--expect-commit` 必须等于目标 commit | 任何人（手动 workflow_dispatch） | Job Summary；失败按发版记录里的回滚目标处理 |

第 1 步合入后，第 7 步就能闭环：生产 `/api/version` 报的 commit 与目标一致才算“已上线”，不再靠口头或面板截图。

## 手动跑冒烟

```bash
# 版本预览（期望 commit 必填，≥7 位）
node tools/release-acceptance.mjs \
  --url https://<版本前缀>-mxgarage-wrap-studio.haburaaashi.workers.dev \
  --expect-commit <目标 commit>

# 生产（切流量后）
node tools/release-acceptance.mjs \
  --url https://mxgarage-wrap-studio.haburaaashi.workers.dev \
  --expect-commit <目标 commit>
```

或在 GitHub → Actions → **Release acceptance** → Run workflow，填 URL 和期望 commit。

检查项：`/`、`/design`、`/body-lab`、`/model-lab` 均 200；`/api/status` 返回布尔 `configured`；`/api/version` 的 commit 与期望一致；线上 GLB 的 sha256 与该 commit 的 `public/model/motion_metadata.json` `glbSha256` 一致（AGENTS §2 哈希链的“线上”一环）。只做 GET，不调用真实生成。

## GPT 验收的独立性

按 AGENTS §0 体系划分，GPT、dot、codex 为同一体系：

- 本仓库由 Claude（未归入三组）实现的改动、Grok/Muse/Lulu 实现的 PR：GPT 的验收算**非本体系**，可以直接作为独立结论。
- GPT/Codex 实现的 PR（例如 #25、#47、#74、#86、#94）：GPT 只能记录运行事实；对这些 PR 的独立结论要由 Muse、Grok 或 Claude 给出，发版记录里逐条标出。
- drawing 视觉验收始终归体验官（AGENTS §3）。

## 切流量与回滚命令（仅供已授权操作者，文档本身不授权）

```bash
npx wrangler deployments status            # 只读：当前生产版本 ID 与流量占比
npx wrangler versions deploy <目标版本ID>@100%   # 切流量
npx wrangler versions deploy <回滚版本ID>@100%   # 回滚到发版记录里写明的正常版本
```

回滚只针对发版记录里事先写明的版本 ID，单次执行后立刻跑第 7 步冒烟；失败不自动重试，先核实再上报（AGENTS §13）。
