#!/usr/bin/env bash
# claude.yml publish 任务：发布前二次核对，全部通过才把 work 产出的提交推到 feature/*-claude-devloop 分支，并开 Draft PR 或评论。
# 由 claude.test.mjs 用假 gh + 真 git 测试。本脚本来自 main（可信），不检出、不执行 PR 里的任何代码。
# 输入（环境变量）：OUT（work 产物目录）、REPO、N、MODE、BRANCH、START（preflight 记录的准确基线）、EVENT、RUN_ID、RUN_URL、
#   PUSH_URL（git 远端地址）、ENABLED / PAUSED（本任务开始时的仓库变量 DEVLOOP_ENABLED / DEVLOOP_PAUSED）、SPEC（claim 时的 spec 哈希）
# 核对不通过：评论原因 + 加 needs-user，不写入（exit 0）。命令本身失败（非零）时由调用方的 failure() 步骤报告。
set -euo pipefail
. "$(dirname "$0")/lib.sh"
mkdir -p "$OUT"

release() {
  # 本次运行结束（无论结果）释放 WIP 名额：运行中标记与全局互斥锁（implement 与 fix 都持有）
  gh issue edit "$N" -R "$REPO" --remove-label devloop-running || true
  lock_release "$N" "${RUN_ID:-}"
}
stop() {
  printf '执行者：Claude（devloop 云端）；角色：实现者；Issue：#%s\n\n发布前核对未通过，没有推送：%s\n\n产物在本次运行的 artifact 里保留 7 天：%s\n' "$N" "$1" "$RUN_URL" > "$OUT/stop.md"
  gh issue comment "$N" -R "$REPO" --body-file "$OUT/stop.md"
  gh issue edit "$N" -R "$REPO" --add-label needs-user
  release
  echo "published=stopped"
  exit 0
}

if [ ! -f "$OUT/outcome" ]; then
  # 连产物都没有（work 任务整体失败 / 超时被取消）
  echo needs-user > "$OUT/outcome"
  printf '执行者：Claude（devloop）\n\n云端执行任务失败或超时，没有产物，自动循环在此停下，请用户查看：%s\n' "$RUN_URL" > "$OUT/body.md"
fi
if [ "$(tr -d '[:space:]' < "$OUT/outcome")" != "pr" ]; then
  gh issue comment "$N" -R "$REPO" --body-file "$OUT/body.md"
  gh issue edit "$N" -R "$REPO" --add-label needs-user
  release
  echo "published=needs-user"
  exit 0
fi
case "$BRANCH" in feature/*-claude-devloop) ;; *) echo "::error::拒绝推送到非 feature/*-claude-devloop 分支：$BRANCH" >&2; exit 1 ;; esac
case "$START" in *[!0-9a-f]* | '') echo "::error::基线不是 SHA：${START:-空}" >&2; exit 1 ;; esac

# 1. 实时开关
[ "${ENABLED:-}" = "true" ] || stop "devloop 已停用（仓库变量 DEVLOOP_ENABLED 不是 true）。"
[ "${PAUSED:-}" != "true" ] || stop "devloop 已全局暂停（DEVLOOP_PAUSED=true）。"

# 2. 实时标签与状态；3. 认领与冻结 spec（implement）
if [ "$MODE" = "implement" ]; then
  issue=$(gh issue view "$N" -R "$REPO" --json state,labels,body,comments)
  why=$(jq -r '[.labels[].name] as $l | if .state != "OPEN" then "issue 已关闭" elif ($l | index("devloop")) == null then "devloop 标签已被移除" elif ($l | index("hold")) != null then "issue 已加 hold" else "ok" end' <<<"$issue")
  [ "$why" = "ok" ] || stop "$why。"
  mine=$(jq -r --arg m "devloop-claim run=$RUN_ID " '[.comments[]? | select((.author.login | test("^github-actions(\\[bot\\])?$")) and (.body | contains($m)))] | length' <<<"$issue")
  [ "$mine" != "0" ] || stop "找不到本次运行（run $RUN_ID）由 Actions 发出的 claim。"
  others=$(jq -r "$DEVLOOP_OTHER_CLAIMS_JQ" <<<"$issue")
  [ -z "$others" ] || stop "运行期间出现了其他执行者的 claim（$others），按 AGENTS §11 先发者为准。"
  [ -n "${SPEC:-}" ] && [ "$(spec_hash <<<"$issue")" = "$SPEC" ] || stop "issue 正文（冻结 spec）在运行期间被修改，按新 spec 重新开工。"
else
  pr=$(gh pr view "$N" -R "$REPO" --json state,labels,headRefName)
  why=$(jq -r --arg b "$BRANCH" 'if .state != "OPEN" then "PR 已关闭" elif .headRefName != $b then "PR 分支已变化" elif ([.labels[].name] | index("hold")) != null then "PR 已加 hold" else "ok" end' <<<"$pr")
  [ "$why" = "ok" ] || stop "$why。"
fi

work=$(mktemp -d)
git init -q "$work"
cd "$work"
git remote add origin "$PUSH_URL"
git fetch -q origin "$START"
git bundle verify -q "$OUT/work.bundle"
git fetch -q "$OUT/work.bundle" HEAD
new=$(git rev-parse FETCH_HEAD)
git merge-base --is-ancestor "$START" "$new" || { echo "::error::新提交不是从起点延伸的" >&2; exit 1; }

# 4. 准确基线：受测树就是要推的树，不在发布阶段 rebase
remote() { git ls-remote origin "refs/heads/$1" | cut -f1; }
main=$(remote main)
if [ "$MODE" = "implement" ]; then
  [ "$main" = "$START" ] || stop "main 已从 \`$START\` 前进到 \`$main\`；在旧基线上验证的结果不移植到新树，请按新基线重跑。"
  [ -z "$(remote "$BRANCH")" ] || stop "远端已出现分支 \`$BRANCH\`，不覆盖。"
else
  [ "$(remote "$BRANCH")" = "$START" ] || stop "分支 \`$BRANCH\` 在运行期间被更新（不再是 \`$START\`），不覆盖。"
fi

# 5. 文件边界（机器强制，不靠提示词）：既查合入 main 后的净改动，也逐个查每个待推送的提交——
#    中间提交加入又删除的敏感文件也会随历史推上去
git cat-file -e "$main^{commit}" 2>/dev/null || git fetch -q origin "$main"
mb=$(git merge-base "$main" "$new")
commits=$(git rev-list "$new" --not "$START" "$main")
# 路径一律用 -z（NUL 分隔的原始路径）：默认输出会把非 ASCII / 特殊字符路径加引号转义，模式就匹配不上
changed() {
  git diff -z --no-renames --name-only "$mb" "$new"
  for c in $commits; do
    if [ "$(git rev-list --parents -n 1 "$c" | wc -w)" -gt 2 ]; then
      git diff-tree -z --cc --name-only --no-commit-id "$c" # 合并提交：只看它自己引入的改动（与所有父提交都不同的文件）
    else
      git diff-tree -z -r --no-renames --name-only --no-commit-id "$c"
    fi
  done
}
bad=""
while IFS= read -r -d '' f; do
  if [ -n "$f" ] && forbidden_path "$f"; then bad="$bad $(printf '%q' "$f")"; fi
done < <(changed)
[ -z "$bad" ] || stop "改动了禁止路径：${bad# }"
# 符号链接：待推送提交的树里出现、而基线与 main 里都不是符号链接的路径
was_link() { [ "$(git --literal-pathspecs ls-tree "$1" -- "$2" | cut -d ' ' -f 1)" = "120000" ]; }
links=""
for c in $commits; do
  while IFS= read -r -d '' e; do
    [ "${e%% *}" = "120000" ] || continue
    p=${e#*$'\t'}
    was_link "$START" "$p" || was_link "$main" "$p" || links="$links $(printf '%q' "$p")"
  done < <(git ls-tree -r -z "$c")
done
[ -z "$links" ] || stop "新增或改为符号链接：${links# }"

# 6. 提交归属：每个待推送的提交（含合并提交）都带 Executor trailer
for c in $commits; do
  git show -s --format=%B "$c" | grep -x 'Executor: Claude（devloop 云端）' > /dev/null || stop "提交 \`$c\` 缺少 \`Executor: Claude（devloop 云端）\` trailer。"
done

# 核对全部通过：普通推送（分支在此期间被别人更新导致非快进则失败，不覆盖）
git push -q origin "$new:refs/heads/$BRANCH"
if [ "$MODE" = "fix" ]; then
  gh pr comment "$N" -R "$REPO" --body-file "$OUT/body.md"
  # 手动重跑（workflow_dispatch）意味着维护者已排除上次停下的原因：成功推送后去掉 needs-user。hold 是用户的暂停意图，保持不动
  if [ "${EVENT:-}" = "workflow_dispatch" ]; then gh pr edit "$N" -R "$REPO" --remove-label needs-user; fi
  release
else
  title=$(head -c 200 "$OUT/title.txt" 2>/dev/null || true)
  # 自动候选默认 Draft：独立评审与验证通过后再由评审方转 Ready（AGENTS §13 合并要求非 Draft）
  gh pr create -R "$REPO" --draft --base main --head "$BRANCH" --title "${title:-devloop：issue #$N}" --body-file "$OUT/body.md"
  if [ "${EVENT:-}" = "workflow_dispatch" ]; then gh issue edit "$N" -R "$REPO" --remove-label needs-user || true; fi
  release
fi
echo "published=$new"
