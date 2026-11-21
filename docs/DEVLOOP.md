# devloop：云端 Claude 开发主力

来源：[a2a-devloop](https://github.com/daniel-to-the-moon/a2a-devloop) 模板的“云端执行者”部分，按本仓库规则改编（#118）。规则以 main 上的 AGENTS.md / CONTRIBUTING.md 为准，本文只说明这套自动化怎么用。

## 一、循环（当前接入范围）

```
维护者给 issue 打 devloop 标签（= 授权并 Ready）
        │
  【GitHub Actions】claude.yml
     work（只读令牌）：读 issue → 改代码 + 测试 → 跑门禁 → 本地提交 → git bundle
     publish（写权限，不执行仓库代码）：推到 feature/<N>-claude-devloop → 开 PR（Closes #N）
        │
  评审与合并：照 AGENTS §8/§13，由非实现者独立评审、dot 决定、非实现者合并
  需要修复：维护者 `gh workflow run claude.yml -f pr=<PR号>`，Claude 读最新一条“执行者：GPT”评审在同一分支修复
```

**未接入**：审核方 watch（本机或云端 Codex 自动审核、签名标记、自动合并）。接入前，评审仍由 GPT 等按现行流程手动进行；`DEVLOOP_REVIEWER` 保持关闭。

## 二、维护者一次性配置（保留项，agent 不代办）

1. 本机生成订阅令牌（会打开浏览器登录）：
   ```bash
   claude setup-token
   ```
2. 存为仓库 Secret（令牌只粘到终端提示里，不要发到对话、issue 或 PR）：
   ```bash
   gh secret set CLAUDE_CODE_OAUTH_TOKEN -R daniel-to-the-moon/van-sticker-studio
   ```
   只用订阅时**不要**同时设 `ANTHROPIC_API_KEY`，否则改按 API 计费。
3. 允许 Actions 开 PR（publish 需要）：
   ```bash
   gh api -X PUT repos/daniel-to-the-moon/van-sticker-studio/actions/permissions/workflow \
     -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
   ```
4. 可选变量：`gh variable set CLAUDE_MODEL --body <模型 id>`（不设时用 `claude-sonnet-5-5`）；排障时私有仓库可设 `CLAUDE_SHOW_FULL_OUTPUT=true`（本仓库若是公开仓库不要开）。
5. 标签 `devloop`、`needs-user`、`hold` 已建好。

## 三、怎么用

- **派活**：开一个 issue（一件事、可勾选的验收标准），由维护者打 `devloop` 标签。打上即触发、即视为授权。
- **看结果**：成功会开 PR，分支 `feature/<N>-claude-devloop`，正文按 PR 模板写，提交带 `Executor: Claude（devloop 云端）` trailer。
- **停下等人**：Claude 判断命中停止条件或云端失败时，在 issue / PR 留说明并加 `needs-user`。
- **修复**：`gh workflow run claude.yml -f pr=<PR号>`，按 PR 上最新一条“执行者：GPT”评论修；成功推送后自动去掉 `needs-user`（不动 `hold`）。
- **暂停某 PR**：打 `hold`。**全部暂停**：`gh variable set DEVLOOP_PAUSED --body true`（恢复：删掉该变量或改成别的值）。

## 四、Claude 不写代码、直接 needs-user 的情况

收费 / 广告 / 对公众上线；需要新的付费服务或账号；需求互相矛盾或信息不足；以及本仓库硬边界：改 GLB 或其元数据与哈希、品牌字样或 GLB 节点重命名、读写 `.openai/`、`.dev.vars*`、`.env*`、写出密钥、新增或升级依赖、改 `dist/`、改 `.github/workflows/`、改 constitution 或 AGENTS 的决策权与保留项、上线或改平台设置。

## 五、额度与风险

- **额度**：订阅令牌与维护者在 claude.ai、Claude Code 的日常使用共用同一份额度（五小时会话上限 + 每周上限）。额度用完时云端 Claude 会很快失败并加 `needs-user`，等额度重置后用 `workflow_dispatch` 重跑。建议同一时间只放 1 个 `devloop` issue，观察一两周再决定是否升级套餐或改用 API key。
- **令牌**：`work` 任务执行仓库代码且持有模型令牌；依赖被投毒时可能泄露该令牌（拿不到写仓库令牌）。令牌绑定维护者本人的订阅，可随时在本机重新 `claude setup-token` 并覆盖 Secret 使旧令牌失效（是否立即吊销以 Anthropic 当前行为为准，待核实）。
- **共享账号**：所有 agent 目前共用维护者 GitHub 账号，谁都能打 `devloop` 标签；“打标签 = 维护者授权”靠约定，不是技术约束。
- **改工作流的 PR**：publish 用 `GITHUB_TOKEN`，推不了改动 `.github/workflows/` 的提交；这类任务不要交给云端 Claude。
- **门禁**：Claude 在云端用 `npm ci --ignore-scripts` 装依赖；若某项门禁因此跑不了，PR 里会写明，以 PR 上的 `gates` CI 为准。

## 六、文件

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/claude.yml` | `work` + `publish`；`workflow_dispatch` 可按 `pr` 或 `issue` 手动重跑 |
| `scripts/devloop/ctx.sh` | 判断模式（implement / fix）与分支；只修本仓库 `feature/*-claude-devloop` 分支 |
| `scripts/devloop/publish.sh` | 推送分支、开 PR 或评论；不执行仓库代码 |
| `scripts/devloop/install-bun.sh` | 带重试安装 Bun，避开 action 内置下载的偶发失败 |
| `scripts/devloop/claude.test.mjs` | 上述脚本的行为测试，以及读取真实 `claude.yml` 求值触发条件的测试；已加入 `npm test` |
