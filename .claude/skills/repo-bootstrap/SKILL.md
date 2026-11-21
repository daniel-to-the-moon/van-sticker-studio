---
name: repo-bootstrap
description: Use when creating a new GitHub repo or initializing an existing one for (multi-)agent development: CI gates, PR rules, e2e screenshots, gated release, App-identity review gate.
---

# 仓库创建与初始化（多 agent 协作版）

来源：daniel-to-the-moon/van-sticker-studio 2026-11 的整改（#107 发版、#109 e2e、#110 精简规则、#114 身份闸门、#116 Claude Code 项目化）。

**本技能分两层**：第 3 节“默认步骤”只含已在 van-sticker-studio main 上生效、经过评审的做法；第 4 节“候选方案”来自尚未合并或仍有评审异议的 PR，只能作为方案交维护者逐项决定，不能当默认步骤执行。每次使用前先核对第 2 节表格里各 PR 的最新状态，已合并的才可升级为默认。

## 0. 先问清楚（一次问完，没回答就用默认值并写明）

1. 仓库 owner/名称；个人账号还是组织。
2. 技术栈与门禁命令（默认 Node 22：`npm ci --ignore-scripts`、`npm run lint`、`npm test`、`npx tsc --noEmit`、`npm run build`）。
3. 有没有网页界面；部署目标（Cloudflare Workers / 其他 / 不部署）。
4. 有哪些 agent、怎么分体系（同体系互相不算独立评审），维护者的 GitHub 登录名。
5. 本次授权范围：哪些文件可改；哪些属于维护者保留项（账号、App、私钥、Secrets、规则集、分支保护、变量、上线）。

## 1. 硬性边界

- **不注册 GitHub 账号**：GitHub 条款要求账号由真人创建、禁止自动化注册，免费机器账号每人最多一个。
- 不读、不写、不回显任何密钥。账号、GitHub App、私钥、Secrets、Environments、规则集、分支保护、仓库变量、云平台设置都是维护者保留项：agent 不执行、不代为申请，只在维护者要求时给出方案。
- 无人值守装依赖只用 `npm ci --ignore-scripts`（按锁文件、不运行安装脚本、不新增依赖、不改版本）；失败就停下留痕，不自行去掉该参数。
- 所有改动走分支 + PR；不直接推默认分支、不强推、不开 auto-merge；不合并自己的 PR。
- 开工前按目标仓库 AGENTS 的认领规则发完整 claim（授权、执行者与 run、冻结 spec/验收、完整 base SHA、文件/语义锁、冲突检查），授权不明就停在方案。
- 新行为先写失败测试（在故意改坏的实现上变红）再实现。
- 经维护者 GitHub 登录推送时，仓库记录的推送者是维护者；共享登录不能当作可认证的维护者身份，要在 PR 里写明。

## 2. 来源与状态（截至 2026-11-21，用前重新核对）

读取 `daniel-to-the-moon/van-sticker-studio` 仓库里的文件，不要凭记忆重写。

| 能力 | 文件 | 来源 | 状态 |
| --- | --- | --- | --- |
| 四项门禁 CI | `.github/workflows/ci.yml` | main | 已生效 |
| PR / Issue 模板、交接五件套 | `.github/pull_request_template.md`、`.github/ISSUE_TEMPLATE/`、AGENTS §6 | main | 已生效 |
| Claude Code 项目化 | `CLAUDE.md`、`.claude/settings.json`、本技能 | #117 | 评审中 |
| 线上版本可查 + 只读发版冒烟 | `lib/build-info.ts`、`app/api/version/route.ts`、`tools/release-acceptance.mjs` 等 | #108 | 候选；评审要求先拆出只读部分、补本站域名/完整 SHA/哈希校验 |
| 闸门式自动上线 / 自动回滚 | `tools/production-deploy.mjs`、`release-acceptance.yml` 的 deploy 任务 | #108 | 候选；评审要求单独评审，回滚结果与流量恢复待修 |
| 关键路径 e2e + 前后截图对比 | `e2e/*`、`.github/workflows/e2e.yml` | #111 | 候选；head 核对、加载信号、AI 不可用断言、写权限拆分待修 |
| 精简 AGENTS、PR 格式检查、超期 Draft 自动处理 | `AGENTS.md`、`tools/pr-hygiene.mjs`、`tools/stale-drafts.mjs` | #112 | 候选；改 constitution 需维护者署名，stale 判定待修，自动关闭 Draft 未获批准 |
| App 身份独立性闸门 + 初始化脚本 | `tools/independence-gate.mjs`、`tools/bootstrap-github.mjs`、`docs/process/agent-identities.md` | #115 | 候选；共享维护者身份、视觉标签可信来源、fork 推送者来源仍待评审，未获批准配置任何 App/私钥/规则集 |

## 3. 默认步骤（只用已生效的做法，每步一个 PR）

1. **建仓库**：维护者自己建（或在维护者明确授权且环境允许时用 `gh repo create`）。`.gitignore` 加 `.env*`、`.dev.vars`、`dist/`、`node_modules/`、`*.pem`。
2. **门禁 CI**：照 `ci.yml` 写一个 `gates` job，PR 与默认分支推送都跑四项门禁；装依赖用锁文件。
3. **规则与模板**：AGENTS（角色/独立性、门禁、密钥红线、交接五件套、禁区、独立评审、先证伪、认领、合并与决策权、保留项）、PR 模板（署名行 + 五件套）、Issue 模板（背景、目标、非目标、验收、回滚、红线）。
4. **Claude Code**：`CLAUDE.md` 用 `@AGENTS.md` 导入且不简化任何条款；`.claude/settings.json` 只免确认 `npm ci --ignore-scripts`、四项门禁和只读 git/gh 命令，deny 读私有配置与本地密钥文件、强推、`--no-verify`、合并、secret/variable 命令、部署命令。（以 #117 合并后的版本为准。）
5. **交接**：`docs/handoff/<日期>-<去向>.md` 记录在途 PR 的精确 head、未解决评审意见、维护者待办与唯一下一步。

## 4. 候选方案（只写方案，交维护者逐项决定）

每项写清：解决什么问题、要改哪些文件、需要维护者做哪些保留项操作、评审里还没解决的风险。维护者批准某一项后，才按目标仓库规则单独开 Issue、claim、PR。

- **线上版本可查 + 只读冒烟**：构建时记录 commit，`/api/version` 可读；冒烟只做 GET、只认本站域名、commit 要完整 40 位、静态大资产哈希必须核对。
- **闸门式自动上线 / 回滚**：与只读部分分开评审；需维护者提供云平台令牌与开关变量；回滚须记录并恢复切换前完整流量分配，如实区分各种失败状态。
- **关键路径 e2e + 截图对比**：证据作业只读、不持久化凭据；写评论/标签放到独立作业；发布前核对 head；截图前等真实加载完成信号。
- **PR 格式检查 / 超期 Draft 处理**：自动关闭他人 Draft 属于流程变更，需维护者批准；判断活动用推送时间并翻完分页。
- **按 GitHub App 身份的独立性闸门**：每个体系一个 App + 一个只发检查的 gate App。GitHub 没有直接创建 App 的 API，只能走 manifest 流程，每个 App 需浏览器确认一次；`tools/bootstrap-github.mjs` 可把其余步骤交给 gh，但只能由维护者本人在批准后运行。待解决：共享登录下的维护者身份不可认证、视觉标签的可信来源、fork 推送者来源。

## 5. 完成标准

- 每个 PR：完整 claim、四门禁在最终 head 全绿、新测试先红后绿有记录、非本体系独立评审正向、按目标仓库规则由非实现者合并。
- 第 4 节的每个候选项：要么有维护者的明确批准记录并单独立项，要么在汇报里保留为“未决定”。
- 最后给维护者一份简短汇报：已生效了什么、哪些候选待决定、各自需要他做的保留项操作。
