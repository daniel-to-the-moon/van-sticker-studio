# CLAUDE.md

本仓库的规矩以 main 上的 AGENTS.md 为准（constitution.md 优先）。这里只补 Claude Code 专用的做法，不改变、不简化 AGENTS 的任何条款；两者不一致时以 AGENTS 为准。

@AGENTS.md

## Claude 的身份与归属

- Claude 未归入 AGENTS §0 的三个体系。给其他执行者的 PR 评审时算“非本体系”，但仍要先核实自己未参与该实现、绑定精确 head（AGENTS §8）；不评审自己实现的 PR。
- PR、Issue 评论、评审首行写 `执行者：Claude`；署名只用于归因，不认证身份或权限。
- 每个提交带 `Executor: Claude` trailer（CONTRIBUTING），另加 `Co-Authored-By: Claude <noreply@anthropic.com>`；后者不替代前者。
- 经维护者 GitHub 登录推送时，仓库记录的推送者是维护者；在 PR 和 claim 里写明“由 Claude 经维护者账号推送”。

## 开工前（AGENTS §11，缺一项就停在方案，不写代码）

1. 确认授权：任务是 Ready 项，或有维护者/dot 可核实的批准（Issue/PR 上的记录，或维护者在对话中的直接要求，写明时间与原话要点）。授权不明就只给方案。
2. 读对应 Issue/PR、冻结 spec/验收、`docs/handoff/` 下最新交接文档，以及 main 上生效的 AGENTS/CONTRIBUTING。
3. 在 Issue/PR 发 claim 包，字段齐全：实际执行者与 run、授权来源及决策表适用行、冻结 spec/验收、目标/非目标、完整 base SHA、文件/语义锁、依赖、状态责任人、下一步。
4. 冲突检查：最新远端、其他开放 PR 与 claim 的文件和语义是否重叠；确认一人一实现。有冲突先停，交 dot。
5. 分支：`feature/<issue号>-<简述>` 或 `fix/<issue号>-<简述>`，从最新 `origin/main` 切。

## 门禁（与 CI 一致，提交前跑）

```bash
npm ci --ignore-scripts   # 无人值守只按锁文件装，不运行依赖的安装脚本（AGENTS §0）
npm run lint
npm test
npx tsc --noEmit
npm run build
```

- 不新增依赖、不改版本。`npm ci --ignore-scripts` 失败或某项门禁因此跑不了，就停下并在原 Issue 留痕，以 PR 上的 `gates` CI 为准，写明“本地未运行及原因”；不自行去掉 `--ignore-scripts`。
- `vite.config.ts` 会在构建时导入维护者私有的 `.openai/hosting.json`。构建工具读取它是既有构建契约；Claude 不打开、不修改、不复述它（AGENTS §5）。

## 红线（`.claude/settings.json` 已拦截一部分）

- 不读取、不修改、不伪造 `.openai/hosting.json`、`.dev.vars*`、`.env*`。
- 不在任何地方写出密钥；Secrets、Environments、规则集、仓库变量、GitHub App、Cloudflare 设置都是维护者保留项（AGENTS §14），Claude 不执行、不代为申请。
- 不强推、不 `--no-verify`、不改 `dist/`、不改 GLB（只能网页上传，见 AGENTS §2）。
- 新行为先写失败测试，在故意改坏的实现上变红再修绿（AGENTS §9）；PR 里写明先证伪的方式。

## PR 与合并

- 正文用 `.github/pull_request_template.md` 的完整模板，不删减字段。
- 评审意见逐条回复：修了什么、在哪个提交；不同意的写理由。
- 合并与上线按 AGENTS §13/§14：合并决定归 dot（或 §12 条件下的备用协调者），执行合并的须是非实现者且有权限；合并不等于上线。Claude 不合并自己的 PR，不启用 auto-merge，不执行上线、回滚或切流量。

## 技能

- `repo-bootstrap`（`.claude/skills/repo-bootstrap/`）：新建或初始化仓库时的检查清单。其中只有已在 main 生效的部分是默认步骤；来自未合并 PR 的内容是候选方案，需维护者逐项决定。
