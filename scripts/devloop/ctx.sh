#!/usr/bin/env bash
# claude.yml preflight 任务第一步：确认要实现的 issue，确定目标分支与准确基线。由 claude.test.mjs 用假 gh 测试。
# devloop 只做实现，不做评审触发的修复（见 docs/DEVLOOP.md）。
# 输入（环境变量）：EVENT（issues / workflow_dispatch）、N（issue 编号）、REPO
# 输出：向 $GITHUB_OUTPUT 写 branch=、number=、base=（main 的完整 SHA）；不合规时以非零退出
set -euo pipefail
case "${N:-}" in '' | *[!0-9]*) echo "::error::编号必须是数字：${N:-}" >&2; exit 1 ;; esac
case "${EVENT:-}" in issues | workflow_dispatch) ;; *) echo "::error::不支持的触发：${EVENT:-空}（devloop 只做实现）" >&2; exit 1 ;; esac
# 打开、是 issue（不是 PR）、带 devloop、不带 hold。
# needs-user 只在手动触发（workflow_dispatch）时放行：维护者手动重跑即表示已排除上次停下的原因（DEVLOOP.md 第三节）
why=$(gh issue view "$N" -R "$REPO" --json state,labels,url | jq -r --arg ev "$EVENT" '
  [.labels[].name] as $l
  | if .state != "OPEN" then "issue 未打开"
    elif (.url | test("/issues/[0-9]+$") | not) then "不是 issue（devloop 不修复 PR）"
    elif ($l | index("devloop")) == null then "没有 devloop 标签"
    elif ($l | index("hold")) != null then "带 hold 标签（暂停）"
    elif ($ev != "workflow_dispatch") and (($l | index("needs-user")) != null) then "带 needs-user 标签（只能由维护者手动重跑）"
    else "ok" end')
[ "$why" = "ok" ] || { echo "::error::issue #$N 不可实现：$why" >&2; exit 1; }
base=$(gh api "repos/$REPO/git/ref/heads/main" -q .object.sha)
case "$base" in *[!0-9a-f]* | '') echo "::error::取不到完整基线 SHA：${base:-空}" >&2; exit 1 ;; esac
[ "${#base}" -eq 40 ] || { echo "::error::基线 SHA 不是 40 位：$base" >&2; exit 1; }
{
  echo "branch=feature/$N-claude-devloop"
  echo "number=$N"
  echo "base=$base"
} >> "$GITHUB_OUTPUT"
