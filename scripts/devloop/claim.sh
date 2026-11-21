#!/usr/bin/env bash
# claude.yml preflight 任务第二步：开工前认领（AGENTS §10 / §11），implement 与 fix 走同一道闸门。由 claude.test.mjs 用假 gh 测试。
# 本脚本来自 main（可信），不检出、不执行仓库代码；令牌只有 issues: write。
# 顺序：取得全局互斥锁 → 在锁内核对 → 发 claim。锁防并发，下面的核对防“生命周期内的占用”：
#   §10 每人最多一个活动实现，blocked（needs-user）不释放名额——devloop 已有开放 PR 或 blocked 的实现时，不开新的。
# 输入（环境变量）：REPO、N（issue 或 PR 编号）、MODE（implement / fix）、ISSUE（任务所属 issue；implement 时等于 N）、
#   BASE（完整基线 SHA，来自 ctx.sh）、RUN_ID、RUN_URL
# 输出：$GITHUB_OUTPUT 写 go=true|false 与 spec=（任务 issue 正文 sha256，publish 用来核对冻结 spec 未变）
# 不能开工：在 N 上留说明、加 needs-user、go=false（work 不运行）；锁在退出时释放。
set -euo pipefail
. "$(dirname "$0")/lib.sh"
MODE=${MODE:-implement}
ISSUE=${ISSUE:-$N}
if [ "$MODE" = "implement" ]; then
  own_branch="feature/$N-claude-devloop"
  retry="gh workflow run claude.yml -f issue=$N"
else
  own_branch=""
  retry="gh workflow run claude.yml -f pr=$N"
fi

stop() {
  printf '执行者：Claude（devloop 云端）；角色：实现者；Issue：#%s\n\n未开工：%s\n\n没有写入任何代码。处理后由维护者手动重跑：`%s`。运行：%s\n' "$ISSUE" "$1" "$retry" "$RUN_URL" > "${RUNNER_TEMP:-/tmp}/claim-stop.md"
  gh issue comment "$N" -R "$REPO" --body-file "${RUNNER_TEMP:-/tmp}/claim-stop.md"
  gh issue edit "$N" -R "$REPO" --add-label needs-user
  echo "go=false" >> "$GITHUB_OUTPUT"
  exit 0
}

# 1. 全局互斥锁（原子创建标签；持有到发布结束）。之后任何退出（含 stop）只要没认领成功，都释放自己的锁
lock_acquire "$N" "$RUN_ID" || stop "已有 devloop 运行持有互斥锁（$(lock_holder)）。devloop 同一时间只运行一项实现或修复。若确认那次运行已结束，维护者删除仓库标签 \`devloop-lock\` 后重跑。"
trap '[ "${claimed:-}" = 1 ] || lock_release "$N" "$RUN_ID"' EXIT

# 2. §10 一个活动实现：其他 devloop 分支上的开放 PR、其他带 devloop claim 且 needs-user（blocked）的 issue 都占着名额
prs=$(gh pr list -R "$REPO" --state open --limit 200 --json number,headRefName)
if [ "$MODE" = "fix" ]; then own_branch=$(gh pr view "$N" -R "$REPO" --json headRefName -q .headRefName); fi
active=$(jq -r --arg own "$own_branch" '[.[] | select((.headRefName | test("^feature/[0-9]+-(.*-)?claude-devloop$")) and .headRefName != $own) | "#\(.number)"] | join(" ")' <<<"$prs")
[ -z "$active" ] || stop "devloop 已有活动实现（PR ${active}，等待评审 / 合并）。AGENTS §10 每人最多一个活动实现，合并或关闭后再开。"
blocked=$(gh issue list -R "$REPO" --state open --label devloop --label needs-user --limit 100 --json number,comments \
  | jq -r --arg n "$ISSUE" '[.[] | select((.number | tostring) != $n) | select(any(.comments[]?; .body | contains("devloop-claim"))) | "#\(.number)"] | join(" ")')
[ -z "$blocked" ] || stop "devloop 有 blocked 的实现（issue ${blocked}，带 needs-user）。AGENTS §10 blocked 不释放名额；维护者处理并重跑它，或去掉它的 devloop 标签后再开新项。"

# 3. 任务的有效认领与冻结 spec
issue=$(gh issue view "$ISSUE" -R "$REPO" --json body,comments)
others=$(jq -r "$DEVLOOP_OTHER_CLAIMS_JQ" <<<"$issue")
[ -z "$others" ] || stop "issue #$ISSUE 有其他执行者的 claim（$others）。按 AGENTS §11 先发者为准，devloop 让出。"
spec=$(spec_hash <<<"$issue")
if [ "$MODE" = "implement" ]; then
  task=$(jq -r --arg n "$N" '[.[] | select(.headRefName | test("^(feature|fix)/" + $n + "-")) | "#\(.number)"] | join(" ")' <<<"$prs")
  [ -z "$task" ] || stop "本任务已有开放 PR（$task）。按 AGENTS §10 同一任务同一时刻只有一个开放 PR。"
  exists=$(gh api "repos/$REPO/git/matching-refs/heads/$own_branch" -q "[.[] | select(.ref == \"refs/heads/$own_branch\")] | length")
  [ "$exists" = "0" ] || stop "远端已有分支 \`$own_branch\`（上一次的成果）。不覆盖；确认可以丢弃后由维护者删除该分支，或改为修复它所在的 PR。"
else
  # 修复只做 devloop 自己认领过的实现，且冻结 spec 自认领以来没有变
  was=$(claimed_spec <<<"$issue")
  [ -n "$was" ] || stop "issue #$ISSUE 上没有 devloop 的实现 claim，这个 PR 不是 devloop 认领的实现，不修。"
  [ "$was" = "$spec" ] || stop "issue #$ISSUE 正文（冻结 spec）在认领后被修改。按新 spec 需要重新认领实现，不在旧 PR 上修。"
  pr=$(gh pr view "$N" -R "$REPO" --json comments)
  others=$(jq -r "$DEVLOOP_OTHER_CLAIMS_JQ" <<<"$pr")
  [ -z "$others" ] || stop "PR #$N 有其他执行者的 claim（$others），devloop 让出。"
  review=$(jq -j '[.comments[]? | select(.body | startswith("执行者：GPT"))] | last | (.body // "")' <<<"$pr" | sha256sum | cut -c1-64)
fi

# 4. 发 claim
gh issue edit "$N" -R "$REPO" --add-label devloop-running
if [ "$MODE" = "implement" ]; then
  cat > "${RUNNER_TEMP:-/tmp}/claim.md" <<EOF
执行者：Claude（devloop 云端）｜claim #$N
<!-- devloop-claim run=$RUN_ID base=$BASE spec=$spec -->

- 实际执行者 / run：Claude（devloop 云端，GitHub Actions）$RUN_URL
- 授权：维护者给本 issue 打 \`devloop\` 标签（docs/DEVLOOP.md）；决策表 AGENTS @ \`$BASE\` §14「派单、认领」行，在给 dot 的常设委托下认领，dot 可否决。
- 冻结 spec / 验收：本 issue 正文，sha256 \`$spec\`。运行期间正文被改动，发布前核对不通过，不写入。
- 目标 / 非目标：按 issue 正文；不做正文以外的改动。
- base：main \`$BASE\`（完整 SHA）。main 在运行期间前进则不发布，重新开工。
- 文件 / 语义锁：开工前未知，以 PR 中的实际文件清单为准；之后的修复限于该清单与 tests/、docs/。机器强制的禁止路径见 scripts/devloop/lib.sh（GLB 与资产元数据、dist、.github、密钥与私有配置、依赖清单、constitution / AGENTS / CLAUDE、devloop 自身）。devloop 同一时间只有一个活动实现（全局锁 \`devloop-lock\`，blocked 不释放名额）。
- 依赖：无新增依赖。
- 状态责任人：devloop（本 run）；停下时加 \`needs-user\` 交维护者，blocked 期间不开新项、不自动重派。
- 下一步：实现 → 门禁 → 上传前与发布前核对 → 推送 \`$own_branch\` 并开 Draft PR，等待非本体系独立评审。
EOF
else
  cat > "${RUNNER_TEMP:-/tmp}/claim.md" <<EOF
执行者：Claude（devloop 云端）｜claim #$N（修订，沿用 issue #$ISSUE 的实现 claim）
<!-- devloop-claim run=$RUN_ID base=$BASE spec=$spec issue=$ISSUE review=$review -->

- 实际执行者 / run：Claude（devloop 云端，GitHub Actions）$RUN_URL
- 授权：沿用 issue #$ISSUE 上 devloop 的实现 claim；本次修订按 PR 上最新一条“执行者：GPT”评审（sha256 \`$review\`）。
- 冻结 spec：issue #$ISSUE 正文，sha256 \`$spec\`（与实现 claim 一致）。
- base：PR head \`$BASE\`（完整 SHA）。分支在运行期间被更新则不发布。
- 文件锁：PR 在 base 时已改动的文件，加上 tests/、docs/；越界、禁止路径或缺 trailer 都不推送。
- 状态责任人：devloop（本 run）；停下时加 \`needs-user\` 交维护者，不自动重派。
EOF
fi
gh issue comment "$N" -R "$REPO" --body-file "${RUNNER_TEMP:-/tmp}/claim.md"
{
  echo "go=true"
  echo "spec=$spec"
} >> "$GITHUB_OUTPUT"
claimed=1
