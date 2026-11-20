---
name: repo-bootstrap
description: Use when creating a new GitHub repo or initializing an existing one for (multi-)agent development: CI gates, PR rules, e2e screenshots, gated release, App-identity review gate.
---

# 仓库创建与初始化（多 agent 协作版）

来源：daniel-to-the-moon/van-sticker-studio 2026-11 的整改（#107 发版、#109 e2e、#110 精简规则、#114 身份闸门）。目标：新仓库从第一天起就有门禁、可查的线上版本、自动验收证据和按 GitHub 身份执行的“不能自审”，不靠长篇流程文本和署名自觉。

## 0. 先问清楚（一次问完，没回答就用默认值并写明）

1. 仓库 owner/名称；个人账号还是组织。
2. 技术栈与门禁命令（默认 Node 22：`npm ci`、`npm run lint`、`npm test`、`npx tsc --noEmit`、`npm run build`）。
3. 有没有网页界面（决定是否上 e2e 与截图对比）。
4. 部署目标（Cloudflare Workers / 其他 / 不部署）。
5. 有哪些 agent、怎么分体系（同体系互相不算独立评审），维护者的 GitHub 登录名。
6. 是否已有本账号的 agent App（有就复用，只把新仓库加进安装范围）。

## 1. 硬性边界

- **不注册 GitHub 账号**：GitHub 条款要求账号由真人创建、禁止自动化注册，免费机器账号每人最多一个。agent 身份一律用 GitHub App。
- 不读、不写、不回显任何密钥；Secrets、Environments、规则集、分支保护、仓库变量由维护者设置（运行下文的初始化脚本或网页操作），agent 只给命令和步骤。
- 所有改动走分支 + PR；不直接推默认分支、不强推、不开 auto-merge。
- 新行为先写失败测试（在故意改坏的实现上变红）再实现。
- 自动上线默认关闭（`AUTO_DEPLOY` 不设）；第一次上线由维护者手动触发。
- 本会话若通过维护者的 GitHub 连接推送，仓库记录的推送者就是维护者，闸门会按“维护者实现”处理，要在 PR 里说明。

## 2. 文件来源

可复用的实现以 `daniel-to-the-moon/van-sticker-studio` 的默认分支为准；对应 PR 未合并时从 PR 分支取，并先确认该 PR 的评审意见已修完（截至 2026-11-20：#108、#111、#112 仍有待修的 P1/P2，#115 已修）。读取仓库文件，不要凭记忆重写。

| 能力 | 文件 | 来源 PR / 分支 |
| --- | --- | --- |
| 四项门禁 CI | `.github/workflows/ci.yml` | 已在 main |
| 线上版本可查 | `lib/build-info.ts`、`app/api/version/route.ts`、`vite.config.ts` 的 `define` | #108 `feature/107-release-acceptance` |
| 只读发版冒烟 + 闸门式自动上线/回滚 | `tools/release-acceptance.mjs`、`tools/production-deploy.mjs`、`.github/workflows/release-acceptance.yml`、`docs/releases/README.md` 及测试 | #108 |
| 关键路径 e2e + 前后截图对比 | `e2e/*`、`.github/workflows/e2e.yml`、`tests/compare-shots.test.ts` | #111 `feature/109-key-path-e2e` |
| 精简 AGENTS、PR 格式检查、超期 Draft | `AGENTS.md`、`.github/pull_request_template.md`、`tools/pr-hygiene.mjs`、`tools/stale-drafts.mjs`、对应工作流与测试 | #112 `feature/110-slim-agents` |
| App 身份独立性闸门 + 一键初始化 | `.github/agent-identities.json`、`tools/independence-gate.mjs`、`tools/bootstrap-github.mjs`、`.github/workflows/independence-gate.yml`、`.github/workflows/review-ping.yml`、对应测试、`docs/process/agent-identities.md`、`docs/process/setup-apps.html` | #115 `feature/114-independence-gate` |
| Claude Code 项目化 | `CLAUDE.md`、`.claude/settings.json`、`.claude/skills/repo-bootstrap/` | #116 `feature/116-claude-code-project` |

这些文件里写死了 van-sticker-studio 的东西（Worker 名、生产域名、页面路由、`/model-lab` 等），复制后逐个改成新项目的值；身份闸门与初始化脚本已按配置/参数驱动，只改 `agent-identities.json` 和命令参数。

## 3. 步骤（每步一个 PR，任务清单逐项打勾）

### 3.1 建仓库
能建就用 `gh repo create`（或 GitHub API）；当前环境不允许时，请维护者在网页上建好空仓库再继续。加 `.gitignore`：`.env*`、`.dev.vars`、`dist/`、`node_modules/`、私钥文件。

### 3.2 基线：门禁、规则与 Claude Code（PR 1）
- `ci.yml`：PR 与默认分支推送都跑四项门禁，job 名 `gates`。
- `AGENTS.md` 用精简版结构（约 10KB 内）：0 角色/体系/独立性 · 1 门禁 · 2 资产 · 3 视觉验收 · 4 品牌/对外 · 5 密钥红线 · 6 交接五件套 · 7 禁区 · 8 独立评审 · 9 先证伪 · 10 并行与接手 · 11 认领 · 12 停止与异常 · 13 合并/上线/回滚 · 14 决策权（保留项归维护者）· 15 无人复核 · 16 生效。能交给 CI 的规则不写成人工流程。
- `CLAUDE.md`（`@AGENTS.md` 导入 + Claude 署名/门禁/红线/PR 约定）与 `.claude/settings.json`（deny 读私有配置与本地密钥文件、强推、合并、部署与 secret 命令）。
- PR 模板 = 首行 `执行者：<名字>；角色：…；Issue：#n` + 五件套（改了什么 / 按什么规格 / 跑了什么 / 没改什么与局限 / 下一步）。
- `pr-hygiene` 工作流检查首行署名、关联 Issue、五个小节；`hygiene-exempt` 标签豁免。
- `stale-drafts`：Draft 7 天无推送打 `stale`，再 7 天关闭（分支保留）。以推送时间而不是提交日期判断活动，事件列表要翻页。

### 3.3 e2e（有网页界面时，PR 2）
- 对 PR head 与 base 各构建一次、本地起服务，跑同一份 Playwright 关键路径；每步先截图再断言。
- 截图逐张对比：全相同且 head 通过 → 打 `no-visual-change`；有变化 → 撤该标签，新推送撤旧 `visual-accepted`，等维护者/体验官看图。
- 发布结果前核对事件 head 仍是 PR 当前 head；等真正的“加载完成”信号再截图；无密钥环境要断言“AI/外部服务不可用”的诚实状态。
- Playwright 用 `--no-save` 装在独立目录，不动锁文件；不调用付费接口。

### 3.4 发版（有部署时，PR 3）
- 构建时把 commit/分支/时间烘进产物，`GET /api/version` 可读；格式不对报 `unknown`，不猜。
- 每个上传的版本自动跑只读冒烟：关键页面 200、状态接口、版本 commit 与期望完全一致（完整 40 位）、静态大资产哈希；只认本站域名。
- 闸门式自动上线：目标是当前默认分支 head、门禁绿、生产 commit 可读、区间内可见改动的 PR 都有 `visual-accepted`/`no-visual-change` → 切 100% → 生产冒烟 → 失败一次性回滚并如实区分“回滚请求失败/已接受未核实/已恢复/恢复后仍失败”。记录切换前完整流量分配。每次结果写到发布记录 issue。
- 只读验收与切流量分开评审、分开合并。

### 3.5 身份独立性闸门（多 agent 时，PR 4）
- 每个体系一个 GitHub App + 一个只发检查的 gate App。GitHub 没有直接创建 App 的 API，唯一程序化途径是 manifest 流程，每个 App 要在浏览器确认一次。默认用 `tools/bootstrap-github.mjs` 一条命令完成：本地页面串起每个 App 的 Create → Install，私钥存 `~/.config/agent-apps/`（600，不打印），再用 gh 建标签、Environment 与 gate 密钥、写身份表、建规则集。脚本必须由维护者在自己电脑上运行（需要维护者的 gh 登录与浏览器）；agent 只给出完整命令。`docs/process/setup-apps.html` 只作无 gh 时的备用。
- 判定：实现方 = PR 作者 + 分支推送者（仓库活动记录）+ 提交声明的作者（只加严）；需对当前 head 的非本体系或维护者批准；最近一次“要求修改”即拦；可见改动需维护者在当前 head 推送后打的验收标签；fork PR 不放行；所有列表翻页。
- gate 工作流只由 `pull_request_target` / `workflow_run` / `issue_comment` / `workflow_dispatch` 触发，只检出默认分支，`persist-credentials: false`，私钥在只允许默认分支的 Environment。

## 4. 交给维护者的一次性清单（写进初始化 Issue）

1. 在本机运行（先 `gh auth login`）：`node tools/bootstrap-github.mjs --repo OWNER/REPO --prefix <前缀> --systems <体系列表> [--existing <已建的体系,gate>] [--org ORG]`，第一次先加 `--dry-run`。它完成建 App、安装、标签、Environment `independence-gate`（仅默认分支）与 `GATE_APP_ID`/`GATE_APP_PRIVATE_KEY`、身份表、规则集 `agent-governance`。已有 App 时，还要到 App 设置页把新仓库加进安装范围。
2. 体系 App 的私钥（`~/.config/agent-apps/<slug>.pem`）交给对应 agent 平台；gate 私钥只留在 Environment。
3. 部署时：Secrets `CLOUDFLARE_API_TOKEN`（仅 Workers Scripts: Edit）、`CLOUDFLARE_ACCOUNT_ID`；首发手动 `promote`；之后要全自动再设变量 `AUTO_DEPLOY=true`。
4. 规则集：脚本先只要求 `gates`。闸门合并后在任一 PR 评论 `/gate`，等它产出一次检查，再跑 `--repo-only --require-gate` 把 `independence-gate` 锁定到 gate App（GitHub 只允许绑定已上报过的 App）。`e2e`、`pr-hygiene` 也是实际产出过后再加为必需。
5. agent 平台换成 App 令牌并验证后，吊销它们手里维护者的个人令牌。

## 5. 完成标准

- 每个 PR：四门禁绿、新测试先红后绿有记录、非本体系评审正向（初始化阶段可由维护者评审）。
- 有部署时：一个版本预览 `/api/version` 读回正确 commit，冒烟报告存在。
- 有 gate 时：在一个测试 PR 上评论 `/gate`，看到 gate App 发出的 `independence-gate` 检查。
- 最后给维护者一份简短汇报：开了哪些 PR、哪些检查已产出、第 4 节还剩哪几步要他做。
