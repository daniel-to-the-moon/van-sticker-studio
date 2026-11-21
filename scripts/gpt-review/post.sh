#!/usr/bin/env bash
# gpt-review.yml 发布任务：把评审结果渲染成评论，用 GitHub App（mxgarage-vss-gpt）的身份发到 PR 上。
# 本脚本来自 main（可信）；不检出、不执行 PR 代码。由 review.test.mjs 用假 gh 测试。
# 输入（环境变量）：REPO、PR、HEAD（被评审的精确 head）、RULES（评审规则所在的 main SHA）、RESULT_FILE（Codex 的 JSON 输出）、
#   RUN_ID、RUN_URL、GH_TOKEN（App 安装令牌）
# head 已变化：不发（新提交会触发新的评审）。输出不合 schema：发一条“评审输出无效”的评论并以非零退出。
set -euo pipefail
: "${REPO:?}" "${PR:?}" "${HEAD:?}" "${RULES:?}" "${RESULT_FILE:?}" "${RUN_ID:?}" "${RUN_URL:?}"
body=$(mktemp)
head_line="执行者：GPT（CI 评审，mxgarage-vss-gpt）｜PR #$PR 独立复核"
footer="本评论由 GitHub Actions 里的 Codex（GPT 模型）在只读沙箱中生成；评审规则与提示词取自 main @ \`$RULES\`，PR 不能改自己的评审规则。结论只对上面这个 head 有效，head 变化后会重新评审。这是评审意见，不是合并决定。运行：$RUN_URL"

cur=$(gh api "repos/$REPO/pulls/$PR" -q .head.sha)
if [ "$cur" != "$HEAD" ]; then
  echo "PR #$PR 的 head 已从 $HEAD 变为 $cur，不发布过时的评审"
  exit 0
fi

valid='
  (.verdict | IN("pass", "changes", "blocked"))
  and (.summary | type == "string")
  and (.findings | type == "array")
  and all(.findings[]; (.severity | IN("P1", "P2", "P3")) and (.path | type == "string") and ((.line | type) | IN("number", "null"))
      and (.title | type == "string") and (.detail | type == "string") and (.fix | type == "string"))
  and (.checked | type == "array") and all(.checked[]; type == "string")
  and (.not_checked | type == "array") and all(.not_checked[]; type == "string")'
if ! jq -e "$valid" "$RESULT_FILE" > /dev/null 2>&1; then
  printf '%s\n<!-- gpt-ci-review pr=%s head=%s verdict=error run=%s rules=%s -->\n\n**评审输出无效**：Codex 的输出不符合 schema，本次没有结论。请查看运行日志后重跑：`gh workflow run gpt-review.yml -f pr=%s`。\n\n---\n%s\n' \
    "$head_line" "$PR" "$HEAD" "$RUN_ID" "$RULES" "$PR" "$footer" > "$body"
  gh api "repos/$REPO/issues/$PR/comments" -F body=@"$body" > /dev/null
  exit 1
fi

# 模型输出是不可信文本：去掉 HTML 注释记号（防止伪造结论标记）、给 @ 加零宽空格（不提醒任何人）、压平换行与反引号
verdict=$(jq -r .verdict "$RESULT_FILE")
jq -r --arg head_line "$head_line" --arg pr "$PR" --arg head "$HEAD" --arg run "$RUN_ID" --arg rules "$RULES" --arg footer "$footer" '
  def clean: gsub("<!--"; "&lt;!--") | gsub("-->"; "--&gt;") | gsub("@"; "@​");
  def inline: clean | gsub("[\r\n]+"; " ") | gsub("`"; "'"'"'");
  def vlabel: {"pass": "通过（未发现 P1 / P2）", "changes": "需要修改（有 P1 / P2）", "blocked": "无法给出结论（阻塞）"}[.];
  [
    $head_line,
    "<!-- gpt-ci-review pr=\($pr) head=\($head) verdict=\(.verdict) run=\($run) rules=\($rules) -->",
    "",
    "**结论：\(.verdict | vlabel)**｜固定 head `\($head)`",
    "",
    (.summary | clean),
    "",
    "**问题（\(.findings | length)）**",
    (if (.findings | length) == 0 then "- 无" else
      (.findings | sort_by(.severity)[] | "- **\(.severity)** `\(.path | inline)\(if .line then ":\(.line)" else "" end)` \(.title | inline)：\(.detail | inline) 修法：\(.fix | inline)")
    end),
    "",
    "**已检查**：\(if (.checked | length) == 0 then "无" else (.checked | map(inline) | join("；")) end)",
    "",
    "**未检查**：\(if (.not_checked | length) == 0 then "无" else (.not_checked | map(inline) | join("；")) end)",
    "",
    "---",
    $footer
  ] | join("\n")' "$RESULT_FILE" > "$body"
gh api "repos/$REPO/issues/$PR/comments" -F body=@"$body" > /dev/null
echo "posted verdict=$verdict head=$HEAD"
