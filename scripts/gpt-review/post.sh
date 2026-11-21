#!/usr/bin/env bash
# gpt-review.yml 发布任务：机器核对后，把评审结果渲染成评论，用 GitHub App（mxgarage-vss-gpt）的身份发到 PR 上。
# 本脚本来自 main（可信）；不检出、不执行 PR 代码。由 review.test.mjs 用假 gh 测试。
# 输入（环境变量）：REPO、PR、HEAD（被评审的精确 head）、RULES（评审规则所在的 main SHA）、RESULT_FILE（Codex 的 JSON 输出）、
#   RUN_ID、RUN_URL、READ_TOKEN（只读，用于所有查询）、APP_TOKEN（App 安装令牌，只用于发评论）、BOT_LOGIN（App 的机器人登录名）、
#   REQUIRED_CHECKS_FILE（main 上登记的必需检查清单）、WAIT_SECONDS（等必需检查完成的最长秒数）、POLL_SECONDS（轮询间隔，默认 30）
# 机器核对（模型的结论不能越过它们）：
#   - head 已变化：不发（新提交会触发新的评审）；
#   - 本 App 对同一 head 已有有效评审：不重复发（事件触发与 devloop 手动触发可能落在同一 head 上）；
#   - 输出不合 schema：发“评审输出无效”并以非零退出（运行标红，不算通过）；
#   - pass 只在必需检查全部完成且成功、实现者不属于评审者体系时成立，否则降为 blocked 并写明原因。
set -euo pipefail
: "${REPO:?}" "${PR:?}" "${HEAD:?}" "${RULES:?}" "${RESULT_FILE:?}" "${RUN_ID:?}" "${RUN_URL:?}" "${READ_TOKEN:?}" "${APP_TOKEN:?}" "${BOT_LOGIN:?}" "${REQUIRED_CHECKS_FILE:?}"
WAIT_SECONDS=${WAIT_SECONDS:-0}
POLL_SECONDS=${POLL_SECONDS:-30}
rd() { GH_TOKEN=$READ_TOKEN gh api "$@"; }
post_comment() { GH_TOKEN=$APP_TOKEN gh api -X POST "repos/$REPO/issues/$PR/comments" -F body=@"$1" > /dev/null; }
body=$(mktemp)
head_line="执行者：GPT（CI 评审，mxgarage-vss-gpt）｜PR #$PR 独立复核"
footer="本评论由 GitHub Actions 里的 Codex（GPT 模型）在只读沙箱中生成；评审规则、提示词与必需检查清单取自 main @ \`$RULES\`，PR 不能改自己的评审规则。结论只对上面这个 head 有效，head 变化后会重新评审。这是评审意见，不是合并决定。运行：$RUN_URL"

cur=$(rd "repos/$REPO/pulls/$PR" -q .head.sha)
if [ "$cur" != "$HEAD" ]; then
  echo "PR #$PR 的 head 已从 $HEAD 变为 $cur，不发布过时的评审"
  exit 0
fi

# 去重：本 App 在同一 head 上已有非 error 的评审就不再发（最多翻 10 页评论）
for page in 1 2 3 4 5 6 7 8 9 10; do
  c=$(rd "repos/$REPO/issues/$PR/comments?per_page=100&page=$page")
  if jq -e --arg bot "$BOT_LOGIN" --arg m "<!-- gpt-ci-review pr=$PR head=$HEAD verdict=" \
    'any(.[]; .user.login == $bot and (.body | contains($m)) and ((.body | contains("verdict=error")) | not))' <<<"$c" > /dev/null; then
    echo "本 App 已对 head $HEAD 发过评审，不重复发"
    exit 0
  fi
  [ "$(jq length <<<"$c")" -ge 100 ] || break
done

valid='
  (.verdict | IN("pass", "changes", "blocked"))
  and (.summary | type == "string")
  and (.findings | type == "array")
  and all(.findings[]; (.severity | IN("P1", "P2", "P3")) and (.path | type == "string") and ((.line | type) | IN("number", "null"))
      and (.title | type == "string") and (.detail | type == "string") and (.fix | type == "string"))
  and (.checked | type == "array") and all(.checked[]; type == "string")
  and (.not_checked | type == "array") and all(.not_checked[]; type == "string")'
if ! jq -e "$valid" "$RESULT_FILE" > /dev/null 2>&1; then
  printf '%s\n<!-- gpt-ci-review pr=%s head=%s verdict=error run=%s rules=%s -->\n\n**评审输出无效**：Codex 的输出不符合 schema，本次没有结论。请查看运行日志后重跑：`gh workflow run gpt-review.yml --ref main -f pr=%s`。\n\n---\n%s\n' \
    "$head_line" "$PR" "$HEAD" "$RUN_ID" "$RULES" "$PR" "$footer" > "$body"
  post_comment "$body"
  exit 1
fi

# 必需检查（main 上登记的清单）：等到全部完成或超时；完整翻页，取不全就算截断
required=$(sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$REQUIRED_CHECKS_FILE" | sed '/^$/d')
checks_state() { # 输出 JSON：{truncated, runs: [{name, status, conclusion}]}；同名取最新
  local page=1 all='[]' total=0 got
  while [ "$page" -le 10 ]; do
    got=$(rd "repos/$REPO/commits/$HEAD/check-runs?per_page=100&page=$page")
    total=$(jq '.total_count' <<<"$got")
    all=$(jq -c --argjson a "$all" '$a + [.check_runs[] | {name, status, conclusion, started_at}]' <<<"$got")
    [ "$(jq length <<<"$all")" -lt "$total" ] || break
    [ "$(jq '.check_runs | length' <<<"$got")" -gt 0 ] || break
    page=$((page + 1))
  done
  jq -c --argjson total "$total" '{truncated: (length < $total), runs: (group_by(.name) | map(sort_by(.started_at // "") | last))}' <<<"$all"
}
gate() { # 输出不满足的必需检查说明（每行一条），空 = 全部完成且成功
  local st=$1 name r
  if [ "$(jq -r .truncated <<<"$st")" = "true" ]; then echo "检查结果查询不完整（超过 1000 条或翻页失败）"; fi
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    r=$(jq -r --arg n "$name" '[.runs[] | select(.name == $n)] | first | if . == null then "缺失" elif .status != "completed" then "未完成（\(.status)）" elif .conclusion != "success" then "未通过（\(.conclusion)）" else "" end' <<<"$st")
    [ -z "$r" ] || echo "$name：$r"
  done <<<"$required"
}
waited=0
while :; do
  st=$(checks_state)
  unmet=$(gate "$st")
  # 只剩“未完成”时才继续等；缺失、失败、截断不会自己变好太多，但缺失可能是还没开始跑，也等
  if [ -z "$unmet" ] || ! grep -qE '未完成|缺失' <<<"$unmet" || [ "$waited" -ge "$WAIT_SECONDS" ]; then break; fi
  sleep "$POLL_SECONDS"
  waited=$((waited + POLL_SECONDS))
done

# 独立性：PR 提交的 Executor trailer 里出现 GPT / dot / codex，说明实现者与本评审者同属一个体系（AGENTS §0）
executors=$(rd "repos/$REPO/pulls/$PR/commits?per_page=100" -q '[.[].commit.message | capture("(?m)^Executor: *(?<e>.*)$"; "g").e] | unique | join("；")')
same_family=$(grep -qiE 'gpt|dot|codex' <<<"$executors" && echo yes || echo no)

model_verdict=$(jq -r .verdict "$RESULT_FILE")
verdict=$model_verdict
reasons=""
if [ "$model_verdict" = "pass" ]; then
  if [ -n "$unmet" ]; then verdict=blocked; reasons="必需检查未满足（等待 ${waited} 秒后）：$(awk 'NR > 1 { printf "；" } { printf "%s", $0 }' <<<"$unmet")"; fi
  if [ "$same_family" = "yes" ]; then
    verdict=blocked
    reasons="${reasons:+$reasons；}实现者（$executors）与本评审者同属 GPT 体系，本评审不算独立评审（AGENTS §0 / §8）"
  fi
fi
checks_line=$(if [ -z "$required" ]; then echo "未登记必需检查"; elif [ -z "$unmet" ]; then echo "$(awk 'NR > 1 { printf "、" } { printf "%s", $0 }' <<<"$required") 全部完成且成功"; else awk 'NR > 1 { printf "；" } { printf "%s", $0 }' <<<"$unmet"; fi)

# 模型输出是不可信文本：去掉 HTML 注释记号（防止伪造结论标记）、给 @ 加零宽空格（不提醒任何人）、压平换行与反引号
jq -r --arg head_line "$head_line" --arg pr "$PR" --arg head "$HEAD" --arg run "$RUN_ID" --arg rules "$RULES" --arg footer "$footer" \
  --arg verdict "$verdict" --arg model "$model_verdict" --arg reasons "$reasons" --arg checks "$checks_line" --arg execs "${executors:-未知}" '
  def clean: gsub("<!--"; "&lt;!--") | gsub("-->"; "--&gt;") | gsub("@"; "@​");
  def inline: clean | gsub("[\r\n]+"; " ") | gsub("`"; "'"'"'");
  def vlabel: {"pass": "通过（未发现 P1 / P2，必需检查全绿）", "changes": "需要修改（有 P1 / P2）", "blocked": "无法给出通过结论（阻塞）"}[.];
  [
    $head_line,
    "<!-- gpt-ci-review pr=\($pr) head=\($head) verdict=\($verdict) run=\($run) rules=\($rules) -->",
    "",
    "**结论：\($verdict | vlabel)**｜固定 head `\($head)`",
    (if $reasons != "" then "\n机器核对把模型给出的 `\($model)` 降为 `\($verdict)`：\($reasons)。" else empty end),
    "",
    (.summary | clean),
    "",
    "**必需检查（机器核对）**：\($checks | inline)｜**实现者**：\($execs | inline)",
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
post_comment "$body"
echo "posted verdict=$verdict (model=$model_verdict) head=$HEAD"
