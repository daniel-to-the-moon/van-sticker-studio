#!/usr/bin/env bash
# claude.yml work 任务最后一步（前面任一步失败也运行）：决定 outcome，打包要发布的提交；不发布时保全已有成果。由 claude.test.mjs 测试。
# 在仓库工作树里运行；脚本本身是检出前从 main 复制到 RUNNER_TEMP 的可信版本。
# 输入（环境变量）：OUT、START（基线 SHA）、RUN_ID、RUN_URL、CLAUDE_OUTCOME（Claude 步骤结果）
# 输出：$OUT/outcome（pr / needs-user）、$OUT/body.md；pr 时 $OUT/work.bundle（publish 只推它）；
#       不发布但有改动时 $OUT/recovery.bundle（恢复快照，publish 从不推送它）
set -uo pipefail
mkdir -p "$OUT"

# 保全（AGENTS §6 / §12）：已有本地提交 + 未提交改动（不含 .gitignore 忽略的文件）打成恢复快照，写明取回方法
recover() {
  [ -n "${START:-}" ] || return 0
  if [ "$(git rev-parse HEAD 2> /dev/null)" = "$START" ] && [ -z "$(git status --porcelain 2> /dev/null)" ]; then return 0; fi
  git add -A
  git diff --cached --quiet || git -c user.name=claude-devloop -c user.email=claude-devloop@users.noreply.github.com \
    commit -q -m "devloop：恢复快照（不发布）" -m "Executor: Claude（devloop 云端）"
  if git bundle create "$OUT/recovery.bundle" "$START..HEAD" HEAD 2> /dev/null; then
    printf '\n**已保全成果**（未推送）：本次运行 artifact `devloop-%s` 里的 `recovery.bundle`（保留 7 天），快照 `%s`。取回：\n```bash\ngh run download %s -n devloop-%s\ngit fetch recovery.bundle HEAD:refs/heads/devloop-recovery-%s\n```\n' \
      "$RUN_ID" "$(git rev-parse HEAD)" "$RUN_ID" "$RUN_ID" "$RUN_ID" >> "$OUT/body.md"
  else
    printf '\n保全失败：无法打包恢复快照，见运行日志：%s\n' "$RUN_URL" >> "$OUT/body.md"
  fi
}

if [ "${CLAUDE_OUTCOME:-}" != "success" ]; then
  # Claude 这一步失败、超时或没运行：不发布任何代码，只报告并保全
  printf '执行者：Claude（devloop）\n\n云端执行没有正常完成（Claude 步骤结果：%s），自动循环在此停下，请用户查看：%s\n' "${CLAUDE_OUTCOME:-未运行}" "$RUN_URL" > "$OUT/body.md"
  echo needs-user > "$OUT/outcome"
  rm -f "$OUT/work.bundle"
  recover
  exit 0
fi
test -f "$OUT/outcome" || echo needs-user > "$OUT/outcome"
test -f "$OUT/body.md" || printf '执行者：Claude（devloop）\n\n本次运行没有产出说明，请看 Actions 日志：%s\n' "$RUN_URL" > "$OUT/body.md"
if [ "$(tr -d '[:space:]' < "$OUT/outcome")" = "pr" ] && [ -n "${START:-}" ] && [ "$(git rev-parse HEAD)" != "$START" ] \
  && git bundle create "$OUT/work.bundle" "$START..HEAD" HEAD; then
  echo pr > "$OUT/outcome"
else
  echo needs-user > "$OUT/outcome"
  rm -f "$OUT/work.bundle"
  recover
fi
