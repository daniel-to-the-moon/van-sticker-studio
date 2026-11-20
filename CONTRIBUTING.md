# CONTRIBUTING.md：协作流程

> constitution.md优先，角色、准入、委托及护栏见AGENTS.md。规则经独立评审及完整门禁合入main后生效，分支不提前生效。

## 1. 一条线的流程

```text
Issue（目标/非目标/验收）→ dot 定优先级、Ready
→ 执行者在 Issue 发 claim 评论 → 小分支实现（先写失败测试）→ PR
→ CI：gates（四门禁）＋ e2e（关键路径＋前后截图）＋ pr-hygiene（格式）
→ 非本体系独立评审；有可见变化的由体验官看图打 visual-accepted
→ 非实现者以 expected head 合并
→ Workers Builds 上传版本 → Release acceptance 冒烟 → 发布闸门 → 自动上线（维护者开启 AUTO_DEPLOY 时）
→ 生产冒烟；失败一次性自动回滚 → 发布记录 issue
```

- 一个任务、一组验收、同一时刻一个开放 PR。改同一组文件的任务串行。
- 模板见 .github/ISSUE_TEMPLATE/ 与 .github/pull_request_template.md。

## 2. Issue格式

写背景、目标、非目标、任务、验收、回滚、红线。不知道的标 [NEEDS CLARIFICATION]。认领方式见 AGENTS §11。

## 3. 分支与提交规矩

- 分支名：`feature/<issue号>-<简述>`、`fix/<issue号>-<简述>`、
  `model-r<N>`（模型修订专用，见第 4 节）。
- 一个提交只做一件事；禁止重构＋新功能混装；禁止超大提交。
- 文本文件走正常推送；GLB 等二进制资产只在 GitHub 网页端上传覆盖
  （见 AGENTS.md 第 2 节），绝不走文本推送通道。
- 提交信息写清“改了什么＋对应 issue 号”，不写空话。
- PR/评论/评审首行及提交Executor trailer记录实际执行者用于归因；共享账号/署名不认证权限，不强改历史trailer或补造旧证据。

## 4. 模型修订编号规则（R＋数字）

- 模型修订以 `R＋数字` 连续编号（R7、R8、…、R13），不跳号、不重用。
- 每次修订的 PR 必须交代：
  - 修订目标（改哪里、为什么）；
  - 前一版 GLB sha256 与本版 GLB sha256；
  - 本版改动范围：只动部位清单，附“其余不动”的比对证据；
  - 三处元数据同步清单（`vehicle-assets.ts`、`motion_metadata.json`、
    `wiper_calibration.json`）＋测试钉值同步；
  - 线稿普查对比（真实 drawing 逻辑，改动前后段数）；
  - 目检方法（视角、模式、通过标准）；
  - 回滚方式（见第 5 节）。
- 修订报告随 PR 进仓库（`docs/model-revisions/`），不只放在对话或工作机里。
- 模型是设计展示，绝不能按图开料；对外描述必须如实写覆盖范围。

## 5. 回滚与接手

- 普通代码/spec 回退走 revert PR 与完整准入；保护治理与权限回退归维护者。
- 生产回滚由发布工作流在生产冒烟失败时自动执行一次；其它情况由维护者手动触发同一工作流（见 docs/releases/README.md）。
- 模型回滚重传上一版 GLB 并同步 revision、glbSha256、outputSha256 及测试钉值；上线冒烟自动核对线上哈希。
- 超期 Draft 的标记、关闭与接手见 AGENTS §10。

## 6. 独立评审与验收

评审者未参与实现，只读 diff、规格与证据，给 path:line、影响、修法、检查范围与结论，绑定最终 head。视觉证据来自 e2e 前后截图，结论由体验官以标签给出（AGENTS §3）。

## 7. 权限与委托

日常决定按 AGENTS §14，不逐次请示维护者。各平台分别授权、不共享凭据；密钥、账号、费用、平台设置、保护治理项及新方向归维护者。

## 8. 文档层级

- constitution.md（原则）＞ AGENTS.md（agent 规矩）＞ CONTRIBUTING.md（协作流程）
  ＞ README（产品说明）＞ DEPLOY.md（部署准备）。
- 流程变更先改仓库里的 spec，再执行；不要把流程只记在对话或工作机里。
- 普通spec由dot在委托内决定；constitution、决策表、利益冲突、roster及放松底线归用户。生效点是独立评审/门禁后合入main，在途任务记录迁移，不静默换验收。

## 9. 常驻记录

- 上线记录：发布工作流自动写在发布记录 issue（默认 #107），包括闸门结论、切换前后版本、生产冒烟与回滚。
- 每日验收与复盘：#100、#27，有变化才写，无变化一行。
- 验收回执写：验收者、PR 与 head SHA、检查范围、结论与局限；不代填“通过”。
- 平台配置调整（Secrets、变量、Environments、分支保护）由维护者执行，在相关 Issue 记一句改了什么。
