#!/usr/bin/env bash
# claude.yml work 任务最后一步（前面任一步失败也运行）：决定 outcome，生成要上传的产物。由 claude.test.mjs 测试。
# 在仓库工作树里运行；本脚本与 lib.sh 是检出前从 main 复制到 RUNNER_TEMP 的可信版本。
#
# 上传边界（产物一离开 runner 就不受 publish 的推送核对保护）：
#   - Claude 写的东西在 OUT（执行者可写，视为不可信输入）；本脚本先清空并新建 UPLOAD，只把核对通过的明确文件写进去，
#     工作流只上传 UPLOAD，且只在本脚本成功退出时上传。脚本任何意外错误都以非零退出（不上传，publish 报“没有产物”）。
#   - work.bundle（仅 outcome=pr）：先过与 publish 相同的边界核对（禁止路径 / 符号链接 / trailer，逐提交）、冻结文件范围与密钥扫描。
#   - recovery.bundle（不发布但有改动时）：只含冻结范围内、非禁止路径、非符号链接的净工作树（单个快照提交，不带中间历史），也过密钥扫描。
#   - body.md / title.txt：所有说明追加完之后再做最终密钥扫描，命中就换成不含路径与原文的状态说明。
# 区分两种失败：Claude 步骤失败 → 不发布，进入保全；核对不通过 → 不打包 work.bundle，同样只保全范围内的内容。
# 输入（环境变量）：OUT、UPLOAD、START（基线 SHA）、MODE（implement / fix）、SCOPE_B64（冻结文件范围，base64）、
#   RUN_ID、RUN_URL、CLAUDE_OUTCOME、DEVLOOP_SCAN_1..3（本任务可见的密钥值，只用于比对，不打印）
set -euo pipefail
. "$(dirname "$0")/lib.sh"
: "${OUT:?}" "${UPLOAD:?}" "${RUN_ID:?}" "${RUN_URL:?}"
rm -rf "$UPLOAD"
mkdir -p "$UPLOAD" "$OUT"
MODE=${MODE:-implement}
START=${START:-}
main=$(git rev-parse -q --verify refs/remotes/origin/main 2> /dev/null || echo "$START")
body="$UPLOAD/body.md"
note() { printf '\n%s\n' "$1" >> "$body"; }

# 密钥值清单（长度不足 8 的忽略，避免误判）；只在本 runner 的临时目录，不上传
pat=$(mktemp)
for v in "${DEVLOOP_SCAN_1:-}" "${DEVLOOP_SCAN_2:-}" "${DEVLOOP_SCAN_3:-}"; do
  if [ "${#v}" -ge 8 ]; then printf '%s\n' "$v" >> "$pat"; fi
done
# 扫描先把内容完整写进文件再 grep（不用管道接 grep -q：命中后提前退出会让上游收到 SIGPIPE）；
# 生产内容失败或 grep 出错（退出码 2）一律按“命中”处理
_scan() {
  local r=0
  grep -qaF -f "$pat" "$1" || r=$?
  [ "$r" -ne 1 ]
}
leaks_in() {
  local f
  [ -s "$pat" ] || return 1
  for f in "$@"; do
    if [ -e "$f" ] && _scan "$f"; then return 0; fi
  done
  return 1
}
# bundle 实际带出去的全部对象（提交信息、树、所有 blob，含二进制与合并提交解决冲突时写入的内容）
leaks_git() {
  local t r=0
  [ -s "$pat" ] || return 1
  t=$(mktemp)
  if ! { git rev-list --objects "$1" | cut -d ' ' -f 1 | git cat-file --batch; } > "$t"; then rm -f "$t"; return 0; fi
  _scan "$t" || r=$?
  rm -f "$t"
  return "$r"
}

# 冻结文件范围
scope=$(mktemp)
if [ -n "${SCOPE_B64:-}" ]; then printf '%s' "$SCOPE_B64" | base64 -d > "$scope"; fi
pr_files=$(mktemp)
if [ "$MODE" = "fix" ] && [ -n "$START" ]; then git diff -z --no-renames --name-only "$(git merge-base "$main" "$START")" "$START" > "$pr_files"; fi
allowed() { in_scope "$1" "$scope" || grep -qzxF -- "$1" "$pr_files"; }

# 恢复快照：从基线出发，只纳入冻结范围内、非禁止路径、非符号链接的改动（工作树相对基线的净状态，含未提交与未跟踪文件，
# 不含 .gitignore 忽略的文件）。单个提交，不带中间历史
recover() {
  [ -n "$START" ] || return 0
  local idx p withheld=0 changed=0 tree snap list
  idx=$(mktemp -u)
  list=$(mktemp)
  GIT_INDEX_FILE=$idx git read-tree "$START"
  while IFS= read -r -d '' p; do
    [ -n "$p" ] || continue
    if forbidden_path "$p" || [ -L "$p" ] || ! allowed "$p"; then
      withheld=$((withheld + 1))
      printf '%q\n' "$p" >> "$list"
      continue
    fi
    if [ -e "$p" ]; then GIT_INDEX_FILE=$idx git update-index --add -- "$p"; else GIT_INDEX_FILE=$idx git update-index --force-remove -- "$p"; fi
    changed=1
  done < <(GIT_INDEX_FILE=$idx git diff -z --no-renames --name-only "$START"; GIT_INDEX_FILE=$idx git ls-files -z --others --exclude-standard)
  if [ "$withheld" -gt 0 ]; then
    note "以下 $withheld 个路径不在冻结范围内、属于禁止路径或是符号链接，未纳入恢复快照、不上传：$(LC_ALL=C sort -u "$list" | join_lines ' ')"
  fi
  rm -f "$list"
  if [ "$changed" != 1 ]; then rm -f "$idx"; return 0; fi
  tree=$(GIT_INDEX_FILE=$idx git write-tree)
  rm -f "$idx"
  snap=$(git -c user.name=claude-devloop -c user.email=claude-devloop@users.noreply.github.com \
    commit-tree "$tree" -p "$START" -m "devloop：恢复快照（不发布）" -m "Executor: Claude（devloop 云端）")
  git update-ref refs/heads/devloop-recovery "$snap"
  if leaks_git "$START..$snap"; then
    note "保全失败：快照内容含本任务的密钥值，未上传。成果随 runner 销毁丢失，请查看运行日志：$RUN_URL"
    return 0
  fi
  git bundle create "$UPLOAD/recovery.bundle" "$START..devloop-recovery" 2> /dev/null
  note "**已保全成果**（未推送，单个快照提交 \`$snap\`，不含中间历史）：本次运行 artifact \`devloop-$RUN_ID\` 里的 \`recovery.bundle\`（保留 7 天）。取回：
\`\`\`bash
gh run download $RUN_ID -n devloop-$RUN_ID
git fetch recovery.bundle devloop-recovery:devloop-recovery-$RUN_ID
\`\`\`"
}

outcome=needs-user
if [ "${CLAUDE_OUTCOME:-}" != "success" ]; then
  # Claude 步骤失败、超时或没运行：不发布任何代码，只报告并保全
  printf '执行者：Claude（devloop）\n\n云端执行没有正常完成（Claude 步骤结果：%s），自动循环在此停下，请用户查看：%s\n' "${CLAUDE_OUTCOME:-未运行}" "$RUN_URL" > "$body"
  recover
else
  if [ -f "$OUT/body.md" ]; then cp "$OUT/body.md" "$body"; else printf '执行者：Claude（devloop）\n\n本次运行没有产出说明，请看 Actions 日志：%s\n' "$RUN_URL" > "$body"; fi
  if [ -f "$OUT/title.txt" ]; then head -c 200 "$OUT/title.txt" > "$UPLOAD/title.txt"; fi
  want=$(tr -d '[:space:]' < "$OUT/outcome" 2> /dev/null || true)
  if [ "$want" = "pr" ] && [ -n "$START" ] && [ "$(git rev-parse HEAD)" != "$START" ]; then
    v=$(boundary_violations "$START" "$main" HEAD)
    s=$(scope_violations "$START" "$main" HEAD "$scope" "$([ "$MODE" = "fix" ] && echo pr || true)")
    if [ -n "$v$s" ]; then
      note "未打包、不发布：待推送提交越界——$(printf '%s\n%s' "$v" "$s" | sed '/^$/d' | join_lines '；')"
    elif leaks_git "$START..HEAD"; then
      note "未打包、不发布：待推送提交的内容含本任务的密钥值。"
    else
      git bundle create "$UPLOAD/work.bundle" "$START..HEAD" HEAD
      outcome=pr
    fi
  fi
  if [ "$outcome" != "pr" ]; then recover; fi
fi

# 最终扫描：所有说明都已写完，命中就换成不含路径与原文的状态说明
if leaks_in "$body" "$UPLOAD/title.txt"; then
  printf '执行者：Claude（devloop）\n\n本次运行的说明文字（含核对与保全说明）出现了本任务的密钥值，已整份丢弃、未上传；不发布。请维护者查看运行（日志里密钥已被打码）：%s\n' "$RUN_URL" > "$body"
  rm -f "$UPLOAD/title.txt"
  if [ "$outcome" = "pr" ]; then outcome=needs-user; rm -f "$UPLOAD/work.bundle"; fi
fi
echo "$outcome" > "$UPLOAD/outcome"
rm -f "$pat" "$scope" "$pr_files"
