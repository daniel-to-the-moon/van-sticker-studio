#!/usr/bin/env bash
# claude.yml preflight 任务第二步：开工前取得全局互斥锁（implement 与 fix 都要，WIP 上限 1）；
# implement 另外核对冲突并发 claim（AGENTS §10 / §11；fix 的 claim 就是已有 PR）。由 claude.test.mjs 用假 gh 测试。
# 本脚本来自 main（可信），不检出、不执行仓库代码；令牌只有 issues: write。
# 输入（环境变量）：REPO、N、MODE（implement / fix）、BASE（完整基线 SHA，来自 ctx.sh）、RUN_ID、RUN_URL
# 输出：$GITHUB_OUTPUT 写 go=true|false，implement 另写 spec=（issue 正文 sha256，publish 用来核对 spec 未变）
# 不能开工：在 issue / PR 留说明、加 needs-user、go=false（work 不运行）。
set -euo pipefail
. "$(dirname "$0")/lib.sh"
MODE=${MODE:-implement}
branch="feature/$N-claude-devloop"
retry="gh workflow run claude.yml -f issue=$N"
[ "$MODE" = "implement" ] || retry="gh workflow run claude.yml -f pr=$N"

stop() {
  printf '执行者：Claude（devloop 云端）；角色：实现者；Issue：#%s\n\n未开工：%s\n\n没有写入任何代码。处理后由维护者手动重跑：`%s`。运行：%s\n' "$N" "$1" "$retry" "$RUN_URL" > "${RUNNER_TEMP:-/tmp}/claim-stop.md"
  gh issue comment "$N" -R "$REPO" --body-file "${RUNNER_TEMP:-/tmp}/claim-stop.md"
  gh issue edit "$N" -R "$REPO" --add-label needs-user
  echo "go=false" >> "$GITHUB_OUTPUT"
  exit 0
}

if [ "$MODE" = "implement" ]; then
  issue=$(gh issue view "$N" -R "$REPO" --json body,comments)
  others=$(jq -r "$DEVLOOP_OTHER_CLAIMS_JQ" <<<"$issue")
  [ -z "$others" ] || stop "本 issue 已有其他执行者的 claim（$others）。按 AGENTS §11 先发者为准，devloop 让出。"

  prs=$(gh pr list -R "$REPO" --state open --limit 200 --json number,headRefName \
    | jq -r --arg n "$N" '[.[] | select(.headRefName | test("^(feature|fix)/" + $n + "-")) | "#\(.number)"] | join(" ")')
  [ -z "$prs" ] || stop "本任务已有开放 PR（$prs）。按 AGENTS §10 同一任务同一时刻只有一个开放 PR。"

  exists=$(gh api "repos/$REPO/git/matching-refs/heads/$branch" -q "[.[] | select(.ref == \"refs/heads/$branch\")] | length")
  [ "$exists" = "0" ] || stop "远端已有分支 \`$branch\`（上一次的成果）。不覆盖；确认可以丢弃后由维护者删除该分支，或改为修复它所在的 PR。"
fi

# WIP 上限 1：取得全局互斥锁（原子），持有到发布结束。拿不到就不开工
if ! lock_acquire "$N" "$RUN_ID"; then
  stop "已有 devloop 实现持有互斥锁（$(lock_holder)）。devloop 同一时间只做一项实现（WIP 上限 1，避免文件 / 语义冲突）。若确认那次运行已结束，维护者删除仓库标签 \`devloop-lock\` 后重跑。"
fi
# 取得锁之后任何一步失败（发 claim 失败等）都释放锁，避免锁泄漏
trap '[ "${claimed:-}" = 1 ] || lock_release "$N" "$RUN_ID"' EXIT
# devloop-running：给人看的运行中标记（锁以 devloop-lock 为准）
gh issue edit "$N" -R "$REPO" --add-label devloop-running

if [ "$MODE" != "implement" ]; then
  echo "go=true" >> "$GITHUB_OUTPUT"
  claimed=1
  exit 0
fi
spec=$(spec_hash <<<"$issue")
cat > "${RUNNER_TEMP:-/tmp}/claim.md" <<EOF
执行者：Claude（devloop 云端）｜claim #$N
<!-- devloop-claim run=$RUN_ID base=$BASE spec=$spec -->

- 实际执行者 / run：Claude（devloop 云端，GitHub Actions）$RUN_URL
- 授权：维护者给本 issue 打 \`devloop\` 标签（docs/DEVLOOP.md）；决策表 AGENTS @ \`$BASE\` §14「派单、认领」行，在给 dot 的常设委托下认领，dot 可否决。
- 冻结 spec / 验收：本 issue 正文，sha256 \`$spec\`。运行期间正文被改动，发布前核对不通过，不写入。
- 目标 / 非目标：按 issue 正文；不做正文以外的改动。
- base：main \`$BASE\`（完整 SHA）。main 在运行期间前进则不发布，重新开工。
- 文件 / 语义锁：开工前未知，以 PR 中的实际文件清单为准；机器强制的禁止路径见 scripts/devloop/lib.sh（GLB 与资产元数据、dist、.github、密钥与私有配置、依赖清单、constitution / AGENTS / CLAUDE、devloop 自身）。devloop 同一时间只做一项实现（全局互斥锁 `devloop-lock`）。
- 依赖：无新增依赖。
- 状态责任人：devloop（本 run）；停下时加 \`needs-user\` 交维护者。
- 下一步：实现 → 门禁 → 发布前二次核对 → 推送 \`$branch\` 并开 Draft PR，等待非本体系独立评审。
EOF
gh issue comment "$N" -R "$REPO" --body-file "${RUNNER_TEMP:-/tmp}/claim.md"
{
  echo "go=true"
  echo "spec=$spec"
} >> "$GITHUB_OUTPUT"
claimed=1
