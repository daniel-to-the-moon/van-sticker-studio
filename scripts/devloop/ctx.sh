#!/usr/bin/env bash
# claude.yml preflight 任务第一步：确定模式（implement / fix）、目标分支、编号与准确基线。由 claude.test.mjs 用假 gh 测试。
# 输入（环境变量）：EVENT（issues / issue_comment / workflow_dispatch）、N（issue 或 PR 编号）、REPO、KIND（手动触发时：issue = 实现 issue，其余 = 修复 PR）
# 输出：向 $GITHUB_OUTPUT 写 mode=、branch=、number=、issue=（任务所属 issue；fix 时从分支名 feature/<issue>-…-claude-devloop 取）、base=（完整 SHA）；不合规时以非零退出
set -euo pipefail
case "${N:-}" in '' | *[!0-9]*) echo "::error::编号必须是数字：${N:-}" >&2; exit 1 ;; esac
if [ "$EVENT" = "issues" ] || { [ "$EVENT" = "workflow_dispatch" ] && [ "${KIND:-}" = "issue" ]; }; then
  # 实现 issue：打开、是 issue（不是 PR）、带 devloop、不带 hold。
  # needs-user 只在手动触发（workflow_dispatch）时放行：维护者手动重跑即表示已排除上次停下的原因（DEVLOOP.md 第三节）
  why=$(gh issue view "$N" -R "$REPO" --json state,labels,url | jq -r --arg ev "$EVENT" '
    [.labels[].name] as $l
    | if .state != "OPEN" then "issue 未打开"
      elif (.url | test("/issues/[0-9]+$") | not) then "不是 issue"
      elif ($l | index("devloop")) == null then "没有 devloop 标签"
      elif ($l | index("hold")) != null then "带 hold 标签（暂停）"
      elif ($ev != "workflow_dispatch") and (($l | index("needs-user")) != null) then "带 needs-user 标签（只能由维护者手动重跑）"
      else "ok" end')
  [ "$why" = "ok" ] || { echo "::error::issue #$N 不可实现：$why" >&2; exit 1; }
  mode=implement
  branch="feature/$N-claude-devloop"
  issue=$N
  base=$(gh api "repos/$REPO/git/ref/heads/main" -q .object.sha)
else
  # issue_comment 与 workflow_dispatch 都是修复已有 PR：只接受本仓库、打开、feature/*-claude-devloop 分支、不带 hold 的 PR
  j=$(gh pr view "$N" -R "$REPO" --json headRefName,headRefOid,isCrossRepository,state,labels)
  b=$(jq -r 'select(.isCrossRepository | not) | .headRefName // ""' <<<"$j")
  case "$b" in feature/*-claude-devloop) ;; *) echo "::error::只修复本仓库 feature/*-claude-devloop 分支上的 PR（实际：${b:-跨仓库或不存在}）" >&2; exit 1 ;; esac
  why=$(jq -r 'if .state != "OPEN" then "PR 未打开" elif ([.labels[].name] | index("hold")) != null then "带 hold 标签（暂停）" else "ok" end' <<<"$j")
  [ "$why" = "ok" ] || { echo "::error::PR #$N 不可修复：$why" >&2; exit 1; }
  mode=fix
  branch="$b"
  issue=${b#feature/}
  issue=${issue%%-*}
  case "$issue" in '' | *[!0-9]*) echo "::error::分支名里取不到 issue 编号：$b" >&2; exit 1 ;; esac
  base=$(jq -r .headRefOid <<<"$j")
fi
case "$base" in *[!0-9a-f]* | '') echo "::error::取不到完整基线 SHA：${base:-空}" >&2; exit 1 ;; esac
[ "${#base}" -eq 40 ] || { echo "::error::基线 SHA 不是 40 位：$base" >&2; exit 1; }
{
  echo "mode=$mode"
  echo "branch=$branch"
  echo "number=$N"
  echo "issue=$issue"
  echo "base=$base"
} >> "$GITHUB_OUTPUT"
