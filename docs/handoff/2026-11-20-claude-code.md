# 交接：2026-11-20 Claude 对话 → Claude Code

执行者：Claude。本文件记录在 claude.ai 对话里完成的工作和未完成项，供在 Claude Code 里继续。时间以 2026-11-20 UTC 为准；开工前用 `gh pr view <n>` 核对最新状态。

## 背景结论

- 生产 `/model-lab` 404 的直接原因：Workers Builds 在 main 上只上传版本、不切流量；main `d9a719f` 的版本 `9b1eabf7` 预览上 `/model-lab` 正常。生产最后已知切换是 2026-10-26 的 `39a469bf`（`20aee5d`），**当前生产版本未经 `wrangler deployments status` 核实**。
- 所有 agent 共用 `daniel-to-the-moon`，独立评审与视觉验收无法技术强制 → 方案 B（GitHub App 身份）。维护者已建 `mxgarage-vss-gpt`、`mxgarage-vss-muse`、`mxgarage-vss-grok` 三个 App；gate App 未建。

## 在途 PR（建议合并顺序 #115 → #108 拆分 → #111 → #112 → #116）

| PR | 分支 / head | 内容 | 状态与待办 |
| --- | --- | --- | --- |
| #108 | `feature/107-release-acceptance` / `cd195cc` | `/api/version`、只读发版冒烟、闸门式自动上线与一次性回滚、RC1 记录 | GPT(dot) 要求**拆成两个 PR**：只读验收（版本可查 + 冒烟 + 证据）先行，生产自动化单独评审。待修：冒烟只认本站域名、commit 要求完整 40 位、GLB 哈希必须存在；回滚结果区分“请求失败/已接受未核实/已恢复/恢复后仍失败”；记录并恢复切换前**完整**流量分配；手动 `expect_commit` 先解析成完整 SHA 再 checkout；请求体读取期间保持超时；RC1 记录删掉“豁免 drawing 验收”的写法；文档里“原因已查明/13 项未上线”改为待核实。 |
| #111 | `feature/109-key-path-e2e` / `8c59e44` | Playwright 关键路径 + 前后截图对比 + 标签 | Codex P2：发布结果前核对事件 head 仍是 PR 当前 head；用真正的加载完成信号（加载遮罩消失）再截图；无密钥 CI 要断言 AI 不可用，不能被 `availability` 分支跳过。GPT：证据作业只读、不持久化 checkout 凭据，评论/标签写入拆到独立作业。另见 #113（本地 `wrangler dev` 下两个实验页 SSR 500）。 |
| #112 | `feature/110-slim-agents` / `a9763dc` | AGENTS 36KB→10KB、constitution §1/§3/§5、pr-hygiene、stale-drafts | Codex P1：依赖 #108/#111 的工作流，须在它们之后合并。P2：stale 判定改用推送时间（仓库活动记录）而非提交日期；事件列表翻页，取不到标记时间时不关闭。**需维护者在 PR 上署名确认**（改 constitution 与决策表）。 |
| #115 | `feature/114-independence-gate` / `20b3f43` | App 身份闸门、`bootstrap-github.mjs`、`setup-apps.html` | Codex 的 3 个 P1、2 个 P2 已修并回复；四门禁绿。待非本体系正向评审；映射文件需维护者署名确认。 |
| #116 | `feature/116-claude-code-project` | 本交接、`CLAUDE.md`、`.claude/` | 待评审。 |

## 维护者待办

1. 本机 `gh auth login` 后运行（先加 `--dry-run` 看一遍）：
   ```bash
   node tools/bootstrap-github.mjs --repo daniel-to-the-moon/van-sticker-studio \
     --prefix mxgarage-vss --systems gpt,muse,grok --existing gpt,muse,grok
   ```
   （脚本在 #115 分支；合并前可 `git checkout feature/114-independence-gate` 后运行。）
2. #115 合并后在任一 PR 评论 `/gate`，再运行一次并加 `--repo-only --require-gate`。
3. 在 #112 署名确认 constitution/AGENTS 修改；在 #115 署名确认 `agent-identities.json` 映射。
4. 配 `CLOUDFLARE_API_TOKEN`（仅 Workers Scripts: Edit）、`CLOUDFLARE_ACCOUNT_ID`；首发手动 `promote`；之后再决定是否设 `AUTO_DEPLOY=true`。
5. 各 agent 平台换成 App 私钥后，吊销它们手里的个人令牌。

## Claude Code 里的下一步

1. 拆 #108：新开只读验收 PR（`lib/build-info.ts`、`app/api/version/route.ts`、`vite.config.ts`、`tools/release-acceptance.mjs`、smoke 任务、测试），按上表修完再请评审；生产自动化（`tools/production-deploy.mjs`、deploy 任务）另开 PR。
2. 按上表修 #111、#112 的评审意见，每条在 PR 里回复修复提交。
3. 修完后把 `.claude/skills/repo-bootstrap/SKILL.md` 第 2 节里“仍有待修的 P1/P2”更新为实际状态。

## 本次对话之外的产物

- 维护者电脑上的 `vss-github-apps.html`（旧版建 App 页面）已被 `docs/process/setup-apps.html` 与 `tools/bootstrap-github.mjs` 取代。
- `agent-governance-kit.zip`：通用工具包快照，内容已并入 #115；以仓库为准。
