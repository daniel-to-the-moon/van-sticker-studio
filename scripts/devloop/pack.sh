#!/usr/bin/env bash
# claude.yml work 任务最后一步（前面任一步失败也运行）：决定 outcome、准备要上传的产物。由 claude.test.mjs 测试。
# 在仓库工作树里运行；本脚本与 lib.sh 是检出前从 main 复制到 RUNNER_TEMP 的可信版本。
# 上传边界（产物一离开 runner 就不受 publish 的推送核对保护）：只产出下列明确文件，每个都先过核对——
#   outcome、body.md、title.txt：说明文字，含本任务密钥值则丢弃，只留状态；
#   work.bundle（仅 outcome=pr）：待推送提交，先过与 publish 相同的边界核对（禁止路径 / 符号链接 / trailer，逐提交）与密钥扫描；
#   recovery.bundle（不发布但有改动时）：恢复快照，只含批准范围内的净工作树（单个提交，不带历史、不含禁止路径与符号链接），也过密钥扫描。
# 输入（环境变量）：OUT、START（基线 SHA）、RUN_ID、RUN_URL、CLAUDE_OUTCOME（Claude 步骤结果）、
#   DEVLOOP_SCAN_1..3（本任务可见的密钥值，用于扫描；不打印）
set -uo pipefail
. "$(dirname "$0")/lib.sh"
mkdir -p "$OUT"
rm -f "$OUT/work.bundle" "$OUT/recovery.bundle"
main=$(git rev-parse -q --verify refs/remotes/origin/main 2> /dev/null || echo "${START:-}")
note() { printf '\n%s\n' "$1" >> "$OUT/body.md"; }

# 密钥值清单（长度不足 8 的忽略，避免误判）；文件只在本 runner 的临时目录，不上传
pat=$(mktemp)
for v in "${DEVLOOP_SCAN_1:-}" "${DEVLOOP_SCAN_2:-}" "${DEVLOOP_SCAN_3:-}"; do [ "${#v}" -ge 8 ] && printf '%s\n' "$v" >> "$pat"; done
# 扫描先把内容完整写进临时文件再 grep：不用管道接 grep -q（命中后提前退出会让上游收到 SIGPIPE，pipefail 下反被当成“未命中”）。
# 生产内容失败或 grep 出错（退出码 2）一律按“命中”处理：扫描异常不能当作安全通过。
_scan() { # 参数：内容文件
  grep -qaF -f "$pat" "$1"
  case $? in 1) return 1 ;; *) return 0 ;; esac
}
leaks_in() { # 参数：要上传的文本文件（不存在的跳过）
  [ -s "$pat" ] || return 1
  local f
  for f in "$@"; do [ -e "$f" ] || continue; _scan "$f" && return 0; done
  return 1
}
# 扫描一个提交区间引入的全部对象内容（提交信息、树、所有 blob，含二进制与合并提交解决冲突时写入的内容）——
# 与 bundle 里实际带出去的对象一致，不依赖 git log -p 的 diff（合并提交默认不显示 diff）
leaks_git() { # 参数：区间，如 START..HEAD
  [ -s "$pat" ] || return 1
  local t r
  t=$(mktemp)
  if ! { git rev-list --objects "$1" | cut -d ' ' -f 1 | git cat-file --batch; } > "$t"; then rm -f "$t"; return 0; fi
  _scan "$t"; r=$?
  rm -f "$t"
  return $r
}

# 恢复快照：从基线出发，只纳入批准范围内的改动（工作树相对基线的净状态，含未提交与未跟踪文件，不含 .gitignore 忽略的文件）
recover() {
  [ -n "${START:-}" ] || return 0
  local idx p withheld="" changed=0 tree snap
  idx=$(mktemp -u)
  GIT_INDEX_FILE=$idx git read-tree "$START" || return 0
  while IFS= read -r -d '' p; do
    [ -n "$p" ] || continue
    if forbidden_path "$p" || [ -L "$p" ]; then withheld="$withheld $(printf '%q' "$p")"; continue; fi
    if [ -e "$p" ]; then GIT_INDEX_FILE=$idx git update-index --add -- "$p"; else GIT_INDEX_FILE=$idx git update-index --force-remove -- "$p"; fi
    changed=1
  done < <(GIT_INDEX_FILE=$idx git diff -z --no-renames --name-only "$START"; GIT_INDEX_FILE=$idx git ls-files -z --others --exclude-standard)
  [ -z "$withheld" ] || note "以下路径属于禁止路径或符号链接，未纳入恢复快照、不上传：${withheld# }"
  [ "$changed" = 1 ] || { rm -f "$idx"; return 0; }
  tree=$(GIT_INDEX_FILE=$idx git write-tree)
  rm -f "$idx"
  snap=$(git -c user.name=claude-devloop -c user.email=claude-devloop@users.noreply.github.com \
    commit-tree "$tree" -p "$START" -m "devloop：恢复快照（不发布）" -m "Executor: Claude（devloop 云端）")
  git update-ref refs/heads/devloop-recovery "$snap"
  if leaks_git "$START..$snap"; then
    note "保全失败：快照内容含本任务的密钥值，未上传。成果随 runner 销毁丢失，请查看运行日志：$RUN_URL"
    return 0
  fi
  if git bundle create "$OUT/recovery.bundle" "$START..devloop-recovery" 2> /dev/null; then
    note "**已保全成果**（未推送，单个快照提交 \`$snap\`，不含中间历史）：本次运行 artifact \`devloop-$RUN_ID\` 里的 \`recovery.bundle\`（保留 7 天）。取回：
\`\`\`bash
gh run download $RUN_ID -n devloop-$RUN_ID
git fetch recovery.bundle devloop-recovery:devloop-recovery-$RUN_ID
\`\`\`"
  else
    note "保全失败：无法打包恢复快照，见运行日志：$RUN_URL"
  fi
}

if [ "${CLAUDE_OUTCOME:-}" != "success" ]; then
  # Claude 这一步失败、超时或没运行：不发布任何代码，只报告并保全
  printf '执行者：Claude（devloop）\n\n云端执行没有正常完成（Claude 步骤结果：%s），自动循环在此停下，请用户查看：%s\n' "${CLAUDE_OUTCOME:-未运行}" "$RUN_URL" > "$OUT/body.md"
  echo needs-user > "$OUT/outcome"
  rm -f "$OUT/title.txt"
  recover
else
  test -f "$OUT/outcome" || echo needs-user > "$OUT/outcome"
  test -f "$OUT/body.md" || printf '执行者：Claude（devloop）\n\n本次运行没有产出说明，请看 Actions 日志：%s\n' "$RUN_URL" > "$OUT/body.md"
  # 说明文字先过密钥扫描：命中就整份丢弃，只留状态
  if leaks_in "$OUT/body.md" "$OUT/title.txt"; then
    printf '执行者：Claude（devloop）\n\n本次运行的说明文字含本任务的密钥值，已丢弃、未上传；不发布。请维护者查看运行（日志里密钥已被打码）：%s\n' "$RUN_URL" > "$OUT/body.md"
    rm -f "$OUT/title.txt"
    echo needs-user > "$OUT/outcome"
  fi
  published=no
  if [ "$(tr -d '[:space:]' < "$OUT/outcome")" = "pr" ] && [ -n "${START:-}" ] && [ "$(git rev-parse HEAD)" != "$START" ]; then
    v=$(boundary_violations "$START" "$main" HEAD)
    if [ -n "$v" ]; then
      note "未打包、不发布：待推送提交越界——$(printf '%s' "$v" | paste -sd '；' -)"
    elif leaks_git "$START..HEAD"; then
      note "未打包、不发布：待推送提交的内容含本任务的密钥值。"
    elif git bundle create "$OUT/work.bundle" "$START..HEAD" HEAD; then
      published=yes
    fi
  fi
  if [ "$published" = yes ]; then
    echo pr > "$OUT/outcome"
  else
    echo needs-user > "$OUT/outcome"
    rm -f "$OUT/work.bundle"
    recover
  fi
fi
rm -f "$pat"
exit 0
