# CLAUDE.md

本仓库的规矩以 AGENTS.md 为准（constitution.md 优先），这里只补 Claude Code 专用的约定。

@AGENTS.md

## Claude 的身份与归属

- Claude 未归入 AGENTS §0 的三个体系，给任何体系的 PR 评审都算“非本体系”；不评审自己实现的 PR。
- PR、Issue 评论首行写 `执行者：Claude`。提交信息末尾带 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 用维护者的 GitHub 登录推送时，仓库记录的推送者是维护者；在 PR 里写明“由 Claude 经维护者账号推送”。

## 每次开工

1. 读对应 Issue/PR 和 `docs/handoff/` 下最新一份交接文档。
2. 在 Issue 下发 claim 评论（执行者、范围、要改的文件、base SHA），见 AGENTS §11。
3. 分支：`feature/<issue号>-<简述>` 或 `fix/<issue号>-<简述>`，从最新 `origin/main` 切。

## 门禁（与 CI 一致，提交前跑）

```bash
npm ci
npm run lint
npm test
npx tsc --noEmit
npm run build
```

`vite.config.ts` 会在构建时导入维护者私有的 `.openai/hosting.json`（已在仓库里），构建工具用它没问题，但 Claude 不打开、不修改、不复述它。某项门禁本地跑不了时，以 PR 上的 `gates` CI 为准，并在 PR 里写明“本地未运行”。

## 红线（`.claude/settings.json` 已拦截一部分）

- 不读取、不修改、不伪造 `.openai/hosting.json`、`.dev.vars*`、`.env*`。
- 不在任何地方写出密钥；Secrets、Environments、规则集、仓库变量、Cloudflare 设置由维护者操作，Claude 只给命令。
- 不强推、不 `--no-verify`、不改 `dist/`、不改 GLB（只能网页上传，见 AGENTS §2）。
- 新行为先写失败测试，在故意改坏的实现上变红再修绿（AGENTS §9）；PR 里写明先证伪的方式。

## PR

- 正文用 `.github/pull_request_template.md`：署名行 + 改了什么 / 按什么规格 / 跑了什么 / 没改什么与局限 / 下一步。
- 评审意见逐条回复：修了什么、在哪个提交；不同意的写理由。
- 合并由非实现者按 AGENTS §13 决定；Claude 不合并自己的 PR，不启用 auto-merge。

## 技能

- `repo-bootstrap`（`.claude/skills/repo-bootstrap/`）：新建或初始化仓库时使用，包含门禁、e2e、发版闸门与 App 身份闸门的步骤和文件来源。
