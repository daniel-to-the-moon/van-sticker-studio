#!/usr/bin/env bash
# claude.yml preflight 任务第二步：开工前认领（AGENTS §10 / §11）。由 claude.test.mjs 用假 gh 测试。
# 本脚本来自 main（可信），不检出、不执行仓库代码；令牌只有 issues: write。devloop 只做实现。
# 顺序：取得全局互斥锁 → 在锁内核对 → 发 claim。锁防并发，下面的核对防“生命周期内的占用”：
#   §10 每人最多一个活动实现，blocked（needs-user）不释放名额——devloop 已有开放 PR 或 blocked 的实现时，不开新的。
# 输入（环境变量）：REPO、N（issue 编号）、BASE（main 的完整 SHA，来自 ctx.sh）、RUN_ID、RUN_URL
# 输出：$GITHUB_OUTPUT 写 go=true|false、spec=（issue 正文 sha256）、scope_b64=（冻结文件范围，base64）
# 不能开工：在 issue 上留说明、加 needs-user、go=false（work 不运行）；锁在退出时释放。
set -euo pipefail
. "$(dirname "$0")/lib.sh"
branch="feature/$N-claude-devloop"

stop() {
  printf '执行者：Claude（devloop 云端）；角色：实现者；Issue：#%s\n\n未开工：%s\n\n没有写入任何代码。处理后由维护者手动重跑：`gh workflow run claude.yml -f issue=%s`。运行：%s\n' "$N" "$1" "$N" "$RUN_URL" > "${RUNNER_TEMP:-/tmp}/claim-stop.md"
  gh issue comment "$N" -R "$REPO" --body-file "${RUNNER_TEMP:-/tmp}/claim-stop.md"
  gh issue edit "$N" -R "$REPO" --add-label needs-user
  echo "go=false" >> "$GITHUB_OUTPUT"
  exit 0
}

# 1. 全局互斥锁（原子创建标签；持有到发布结束）。之后任何退出（含 stop）只要没认领成功，都释放自己的锁
lock_acquire "$N" "$RUN_ID" || stop "已有 devloop 运行持有互斥锁（$(lock_holder)）。devloop 同一时间只运行一项实现。若确认那次运行已结束，维护者删除仓库标签 \`devloop-lock\` 后重跑。"
trap '[ "${claimed:-}" = 1 ] || lock_release "$N" "$RUN_ID"' EXIT

# 2. §10 一个活动实现：其他 devloop 分支上的开放 PR、其他带 devloop claim 且 needs-user（blocked）的 issue 都占着名额
prs=$(gh pr list -R "$REPO" --state open --limit 200 --json number,headRefName)
active=$(jq -r --arg own "$branch" '[.[] | select((.headRefName | test("^feature/[0-9]+-(.*-)?claude-devloop$")) and .headRefName != $own) | "#\(.number)"] | join(" ")' <<<"$prs")
[ -z "$active" ] || stop "devloop 已有活动实现（PR ${active}，等待评审 / 合并）。AGENTS §10 每人最多一个活动实现，合并或关闭后再开。"
blocked=$(gh issue list -R "$REPO" --state open --label devloop --label needs-user --limit 100 --json number,comments \
  | jq -r --arg n "$N" "[.[] | select((.number | tostring) != \$n) | select(any(.comments[]?; $DEVLOOP_SELF_CLAIM_JQ)) | \"#\\(.number)\"] | join(\" \")")
[ -z "$blocked" ] || stop "devloop 有 blocked 的实现（issue ${blocked}，带 needs-user）。AGENTS §10 blocked 不释放名额；维护者处理并重跑它，或去掉它的 devloop 标签后再开新项。"

# 3. 任务状态、他人认领、冻结 spec 与冻结文件范围
issue=$(gh issue view "$N" -R "$REPO" --json state,labels,body,comments)
why=$(jq -r '[.labels[].name] as $l | if .state != "OPEN" then "已关闭" elif ($l | index("devloop")) == null then "没有 devloop 标签（授权已撤回）" elif ($l | index("hold")) != null then "带 hold（暂停）" else "ok" end' <<<"$issue")
[ "$why" = "ok" ] || stop "issue #$N $why。"
others=$(jq -r "$DEVLOOP_OTHER_CLAIMS_JQ" <<<"$issue")
[ -z "$others" ] || stop "issue #$N 有其他执行者的 claim（$others）。按 AGENTS §11 先发者为准，devloop 让出。"
task=$(jq -r --arg n "$N" '[.[] | select(.headRefName | test("^(feature|fix)/" + $n + "-")) | "#\(.number)"] | join(" ")' <<<"$prs")
[ -z "$task" ] || stop "本任务已有开放 PR（$task）。按 AGENTS §10 同一任务同一时刻只有一个开放 PR。"
exists=$(gh api "repos/$REPO/git/matching-refs/heads/$branch" -q "[.[] | select(.ref == \"refs/heads/$branch\")] | length")
[ "$exists" = "0" ] || stop "远端已有分支 \`$branch\`（上一次的成果）。不覆盖；确认可以丢弃后由维护者删除该分支。"
spec=$(spec_hash <<<"$issue")
scope=$(mktemp)
scope_patterns <<<"$issue" > "$scope"
[ -s "$scope" ] || stop "issue #$N 正文没有声明冻结文件范围。请在正文里加一个 \`\`\`devloop-scope 代码块，每行一个允许改动的路径或模式（如 \`lib/foo.ts\`、\`tests/foo.test.ts\`、\`components/bar/*\`）。测试文件和要改的共享接口也要列进去，不默认放行任何路径。"
conflicts=$(external_conflicts "$scope" "$N")
[ -z "$conflicts" ] || stop "与外部认领冲突：$(printf '%s' "$conflicts" | join_lines '；')。按 AGENTS §10 / §11 先定接口、切小或串行。"
scope_list=$(sed 's/^/`/; s/$/`/' "$scope" | join_lines '、')

# 4. 发 claim
gh issue edit "$N" -R "$REPO" --add-label devloop-running
cat > "${RUNNER_TEMP:-/tmp}/claim.md" <<CLAIM
执行者：Claude（devloop 云端）｜claim #$N
<!-- devloop-claim run=$RUN_ID base=$BASE spec=$spec -->

- 实际执行者 / run：Claude（devloop 云端，GitHub Actions）$RUN_URL
- 授权：维护者给本 issue 打 \`devloop\` 标签（docs/DEVLOOP.md），同时确认了下面的冻结范围；决策表 AGENTS @ \`$BASE\` §14「派单、认领」行，在给 dot 的常设委托下认领，dot 可否决。
- 冻结 spec / 验收：本 issue 正文，sha256 \`$spec\`。运行期间正文被改动，发布前核对不通过，不写入。
- 目标 / 非目标：按 issue 正文；不做正文以外的改动。
- base：main \`$BASE\`（完整 SHA）。main 在运行期间前进则不发布，重新开工。
- 文件锁（冻结范围，随 spec 哈希冻结，允许改动与冲突检查用同一份清单，不默认放行任何路径）：$scope_list。已核对：其他执行者的开放 PR 未改动这些文件，其他 issue 上他人的 claim 未提到这些路径。范围之外的共享接口不在本次改动内。机器强制的禁止路径见 scripts/devloop/lib.sh（GLB 与资产元数据、dist、.github、密钥与私有配置、依赖清单、constitution / AGENTS / CLAUDE、devloop 自身）。devloop 同一时间只有一个活动实现（全局锁 \`devloop-lock\`，blocked 不释放名额）。
- 依赖：无新增依赖。
- 状态责任人：devloop（本 run）；停下时加 \`needs-user\` 交维护者，blocked 期间不开新项、不自动重派。评审意见不在本 PR 上自动修复，由维护者重新派单。
- 下一步：实现 → 门禁 → 上传前与发布前核对 → 推送 \`$branch\` 并开 Draft PR，等待非本体系独立评审。
CLAIM
gh issue comment "$N" -R "$REPO" --body-file "${RUNNER_TEMP:-/tmp}/claim.md"
{
  echo "go=true"
  echo "spec=$spec"
  echo "scope_b64=$(base64 -w0 < "$scope")"
} >> "$GITHUB_OUTPUT"
claimed=1
