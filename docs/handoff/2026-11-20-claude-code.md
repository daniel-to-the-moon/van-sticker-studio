# 交接：2026-11-20 Claude 对话 → Claude Code

执行者：Claude（经维护者 GitHub 登录推送）。本文件记录在 claude.ai 对话里完成的工作和未完成项。时间以 UTC 为准；**开工前用 `gh pr view <n>` 重新核对**，下表只是 2026-11-21 的快照。规则以 main 上生效的 AGENTS/CONTRIBUTING 为准；下列在途 PR 都未合并，不改变现行规则。

## 背景（已核实 / 待核实分开写）

- 已核实：生产 `/model-lab` 返回 404；main `d9a719f` 的 Workers Builds 版本 `9b1eabf7` 预览上 `/model-lab` 正常；Workers Builds 在 main 上的检查摘要只有版本上传信息。
- 待核实：当前生产服务的版本与源码 SHA（最后已知记录是 2026-10-26 的 `39a469bf` / `20aee5d`，未经 `wrangler deployments status` 核对）；10-26 之后哪些产品 PR 未上线，以核实结果为准。
- 所有 agent 共用 `daniel-to-the-moon` 登录。维护者 2026-11-20 已在 GitHub 建了 `mxgarage-vss-gpt`、`mxgarage-vss-muse`、`mxgarage-vss-grok` 三个 App（未核实安装范围与私钥去向）；gate App 未建。是否采用 App 身份方案仍待维护者决定（见 #115 评审）。

## 在途 PR（均为候选方案，未合并）

| PR | 分支 / head | 内容 | 评审状态与待办 |
| --- | --- | --- | --- |
| #108 | `feature/107-release-acceptance` / `cd195ccd1814c3919cd3f9ed8ff433c9a8215ffc` | `/api/version`、只读冒烟、闸门式自动上线与回滚、RC1 记录 | GPT(dot)：拆成两个 PR，只读验收先行、生产自动化单独评审。待修：冒烟只认本站域名、commit 要完整 40 位、GLB 哈希必须存在；回滚结果区分“请求失败/已接受未核实/已恢复/恢复后仍失败”；记录并恢复切换前完整流量分配；手动 `expect_commit` 先解析成完整 SHA；读取请求体期间保持超时；RC1 记录删掉豁免 drawing 验收的写法；“原因已查明/13 项未上线”改为待核实。 |
| #111 | `feature/109-key-path-e2e` / `8c59e44bb3c650c57e1874ec969d0ed091dbc716` | Playwright 关键路径、前后截图对比、标签 | Codex P2：发布前核对事件 head 仍是当前 head；用真实加载完成信号再截图；无密钥 CI 必须断言 AI 不可用。GPT：证据作业只读、不持久化凭据，评论/标签写入拆到独立作业。另见 #113。 |
| #112 | `feature/110-slim-agents` / `a9763dcdf1fc0bc1a4d00166bc881490ffc1d1fc` | AGENTS 精简、constitution §1/§3/§5、pr-hygiene、stale-drafts | Codex P1：依赖 #108/#111 的工作流。P2：stale 用推送时间、事件翻页、取不到标记时间不关闭。改 constitution 与决策表需维护者本人署名；自动关闭 Draft 未获批准。 |
| #115 | `feature/114-independence-gate` / `20b3f43332c09188991a8afca5b7e430683c2d51` | App 身份闸门、`bootstrap-github.mjs`、`setup-apps.html` | Codex 首轮 P1/P2 已修。GPT(dot) [复核](https://github.com/daniel-to-the-moon/van-sticker-studio/pull/115#issuecomment-7043622460)：共享登录下的维护者批准不可认证、未知或混用身份应不通过、维护者参与实现也需独立评审；视觉标签不能凭通用 Actions 账号；建议先只出诊断结果、补身份来源与精确 head 测试、订正 fork 推送者来源。**未获批准配置任何 App、私钥、规则集；不要运行 `bootstrap-github.mjs`。** |
| #117 | `feature/116-claude-code-project` | 本交接、`CLAUDE.md`、`.claude/` | 评审中（claim 见 #116）。 |

## 维护者待决定（保留项，agent 不代办）

1. 是否核实当前生产版本（`npx wrangler deployments status`）并安排首次补齐上线。
2. #108 拆分后的只读部分是否采纳；生产自动化是否采纳及何时提供令牌。
3. #112 的 constitution/AGENTS 修改是否署名同意；是否同意自动关闭超期 Draft。
4. #115 的身份方案是否继续；如继续，体系映射、App、私钥、规则集、旧令牌切换各自如何安排。

## Claude Code 里的下一步（每项先按 AGENTS §11 发 claim、核授权）

1. #117 评审通过并由非实现者合并后，按本表核对各 PR 最新状态。
2. 已获授权时：拆 #108，先做只读验收 PR 并修完上表待办；修 #111、#112 的评审意见并逐条回复。
3. #115 按 GPT 复核调整为诊断模式，补测试；不做任何平台配置。
4. 各 PR 状态变化后，同步 `.claude/skills/repo-bootstrap/SKILL.md` 第 2 节的状态列。

## 对话之外的产物

- 维护者电脑上的 `vss-github-apps.html`、`agent-governance-kit.zip` 是 2026-11-20 的快照，以仓库内容为准。
