#!/usr/bin/env bash
# claude.yml preflight 任务第二步：开工前认领（AGENTS §10 / §11），implement 与 fix 走同一道闸门。由 claude.test.mjs 用假 gh 测试。
# 本脚本来自 main（可信），不检出、不执行仓库代码；令牌只有 issues: write。
# 顺序：取得全局互斥锁 → 在锁内核对 → 发 claim。锁防并发，下面的核对防“生命周期内的占用”：
#   §10 每人最多一个活动实现，blocked（needs-user）不释放名额——devloop 已有开放 PR 或 blocked 的实现时，不开新的。
# 输入（环境变量）：REPO、N（issue 或 PR 编号）、MODE（implement / fix）、ISSUE（任务所属 issue；implement 时等于 N）、
#   BASE（完整基线 SHA，来自 ctx.sh）、OWNER（仓库所有者登录名：修复只认它发出的评审）、RUN_ID、RUN_URL
# 输出：$GITHUB_OUTPUT 写 go=true|false、spec=（任务 issue 正文 sha256）、scope_b64=（冻结文件范围，base64）；
#   fix 另写 review_url= 与 review=（所依据的可信评审及其正文 sha256）。publish 用这些核对冻结 spec、范围与评审未变
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
  | jq -r --arg n "$ISSUE" "[.[] | select((.number | tostring) != \$n) | select(any(.comments[]?; $DEVLOOP_SELF_CLAIM_JQ)) | \"#\\(.number)\"] | join(\" \")")
[ -z "$blocked" ] || stop "devloop 有 blocked 的实现（issue ${blocked}，带 needs-user）。AGENTS §10 blocked 不释放名额；维护者处理并重跑它，或去掉它的 devloop 标签后再开新项。"

# 3. 任务的有效认领、冻结 spec 与冻结文件范围
issue=$(gh issue view "$ISSUE" -R "$REPO" --json state,labels,body,comments)
why=$(jq -r '[.labels[].name] as $l | if .state != "OPEN" then "已关闭" elif ($l | index("devloop")) == null then "没有 devloop 标签（授权已撤回）" elif ($l | index("hold")) != null then "带 hold（暂停）" else "ok" end' <<<"$issue")
[ "$why" = "ok" ] || stop "任务 issue #$ISSUE $why。"
others=$(jq -r "$DEVLOOP_OTHER_CLAIMS_JQ" <<<"$issue")
[ -z "$others" ] || stop "issue #$ISSUE 有其他执行者的 claim（$others）。按 AGENTS §11 先发者为准，devloop 让出。"
spec=$(spec_hash <<<"$issue")
if [ "$MODE" = "fix" ]; then
  # 修复只做 devloop 自己认领过的实现，且冻结 spec（含冻结文件范围）自认领以来没有变
  was=$(claimed_spec <<<"$issue")
  [ -n "$was" ] || stop "issue #$ISSUE 上没有 devloop 的实现 claim，这个 PR 不是 devloop 认领的实现，不修。"
  [ "$was" = "$spec" ] || stop "issue #$ISSUE 正文（冻结 spec）在认领后被修改。按新 spec 需要重新认领实现，不在旧 PR 上修。"
fi
scope=$(mktemp)
scope_patterns <<<"$issue" > "$scope"
[ -s "$scope" ] || stop "issue #$ISSUE 正文没有声明冻结文件范围。请在正文里加一个 \`\`\`devloop-scope 代码块，每行一个允许改动的路径或模式（如 \`lib/foo.ts\`、\`components/bar/*\`；测试 tests/、*.test.* 默认允许）。"
conflicts=$(external_conflicts "$scope" "$ISSUE")
[ -z "$conflicts" ] || stop "与外部认领冲突：$(printf '%s' "$conflicts" | join_lines '；')。按 AGENTS §10 / §11 先定接口、切小或串行。"
scope_list=$(sed 's/^/`/; s/$/`/' "$scope" | join_lines '、')
if [ "$MODE" = "implement" ]; then
  task=$(jq -r --arg n "$N" '[.[] | select(.headRefName | test("^(feature|fix)/" + $n + "-")) | "#\(.number)"] | join(" ")' <<<"$prs")
  [ -z "$task" ] || stop "本任务已有开放 PR（$task）。按 AGENTS §10 同一任务同一时刻只有一个开放 PR。"
  exists=$(gh api "repos/$REPO/git/matching-refs/heads/$own_branch" -q "[.[] | select(.ref == \"refs/heads/$own_branch\")] | length")
  [ "$exists" = "0" ] || stop "远端已有分支 \`$own_branch\`（上一次的成果）。不覆盖；确认可以丢弃后由维护者删除该分支，或改为修复它所在的 PR。"
else
  pr=$(gh pr view "$N" -R "$REPO" --json comments)
  others=$(jq -r "$DEVLOOP_OTHER_CLAIMS_JQ" <<<"$pr")
  [ -z "$others" ] || stop "PR #$N 有其他执行者的 claim（$others），devloop 让出。"
  # 修复所依据的评审：只认仓库所有者账号发出的“执行者：GPT”评审，固定为当前最新一条（链接 + 正文哈希），work 只按这一条修
  tr=$(trusted_review "${OWNER:?}" <<<"$pr")
  review_url=$(sed -n 1p <<<"$tr")
  review=$(sed -n 2p <<<"$tr")
  [ -n "$review_url" ] || stop "PR #$N 上没有可信评审（由 \`$OWNER\` 发出、首行为“执行者：GPT”的评论），不修。"
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
- 文件锁（冻结范围，随 spec 哈希冻结）：$scope_list，以及 tests/、*.test.*；越界不推送。已核对：其他执行者的开放 PR 未改动这些文件，其他 issue 上他人的 claim 未提到这些路径。语义锁（共享类型、接口、资产元数据、部署行为）无法机器判断，由评审核对。机器强制的禁止路径见 scripts/devloop/lib.sh（GLB 与资产元数据、dist、.github、密钥与私有配置、依赖清单、constitution / AGENTS / CLAUDE、devloop 自身）。devloop 同一时间只有一个活动实现（全局锁 \`devloop-lock\`，blocked 不释放名额）。
- 依赖：无新增依赖。
- 状态责任人：devloop（本 run）；停下时加 \`needs-user\` 交维护者，blocked 期间不开新项、不自动重派。
- 下一步：实现 → 门禁 → 上传前与发布前核对 → 推送 \`$own_branch\` 并开 Draft PR，等待非本体系独立评审。
EOF
else
  cat > "${RUNNER_TEMP:-/tmp}/claim.md" <<EOF
执行者：Claude（devloop 云端）｜claim #$N（修订，沿用 issue #$ISSUE 的实现 claim）
<!-- devloop-claim run=$RUN_ID base=$BASE spec=$spec issue=$ISSUE review=$review -->

- 实际执行者 / run：Claude（devloop 云端，GitHub Actions）$RUN_URL
- 授权：沿用 issue #$ISSUE 上 devloop 的实现 claim；本次修订只按这一条可信评审：$review_url（sha256 \`$review\`）。发布前它若已被更新的评审取代或被修改，不推送。
- 冻结 spec：issue #$ISSUE 正文，sha256 \`$spec\`（与实现 claim 一致）。
- base：PR head \`$BASE\`（完整 SHA）。分支在运行期间被更新则不发布。
- 文件锁：issue #$ISSUE 的冻结范围（$scope_list）、PR 在 base 时已改动的文件，以及 tests/、*.test.*；越界、禁止路径或缺 trailer 都不推送。
- 状态责任人：devloop（本 run）；停下时加 \`needs-user\` 交维护者，不自动重派。
EOF
fi
gh issue comment "$N" -R "$REPO" --body-file "${RUNNER_TEMP:-/tmp}/claim.md"
{
  echo "go=true"
  echo "spec=$spec"
  echo "scope_b64=$(base64 -w0 < "$scope")"
  if [ "$MODE" != "implement" ]; then
    echo "review_url=$review_url"
    echo "review=$review"
  fi
} >> "$GITHUB_OUTPUT"
claimed=1
