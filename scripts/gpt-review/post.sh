#!/usr/bin/env bash
# gpt-review.yml 发布任务：机器核对后，把评审结果渲染成评论，用 GitHub App（mxgarage-vss-gpt）的身份发到 PR 上。
# 本脚本来自评审所用的那份 main（可信，与提示词同一 SHA）；不检出、不执行 PR 代码。由 review.test.mjs 用假 gh 测试。
# 输入（环境变量）：REPO、PR、HEAD（被评审的精确 head）、RULES（评审规则所在的 main SHA）、RESULT_FILE（Codex 的 JSON 输出）、
#   RUN_ID、RUN_URL、READ_TOKEN（只读，用于所有查询）、APP_TOKEN（App 安装令牌，只用于发评论）、BOT_LOGIN（App 的机器人登录名）、
#   REQUIRED_CHECKS_FILE（必需检查清单：每行“检查名 App slug 工作流路径”）、WAIT_SECONDS（等必需检查完成的最长秒数）、POLL_SECONDS（默认 30）
# 机器核对（模型的结论不能越过它们）：
#   - 发评论前（含错误评论）每次都重新核对 PR head 仍是被评审的提交，不是就不发；
#   - 本 App 对同一 head 已有终局结论（pass / changes）就不重复发；blocked / error 不算终局，阻塞解除后可以重新发；
#   - 输出不合 schema：发“评审输出无效”并以非零退出（运行标红，不算通过）；
#   - pass 只在以下全部成立时成立，否则降为 blocked 并写明原因：每项必需检查都能完整查到、来自预期的 App 与工作流、
#     运行在这个 head 上、已完成且成功，且 PR 没有改动这些工作流的定义；完整取到的提交里实现者不属于评审者体系。
#   - 任何查询失败、响应结构不对或结果不完整，都当作“无法核实”，不当作通过。
set -euo pipefail
shopt -s inherit_errexit
: "${REPO:?}" "${PR:?}" "${HEAD:?}" "${RULES:?}" "${RESULT_FILE:?}" "${RUN_ID:?}" "${RUN_URL:?}" "${READ_TOKEN:?}" "${APP_TOKEN:?}" "${BOT_LOGIN:?}" "${REQUIRED_CHECKS_FILE:?}"
WAIT_SECONDS=${WAIT_SECONDS:-0}
POLL_SECONDS=${POLL_SECONDS:-30}
rd() { GH_TOKEN=$READ_TOKEN gh api "$@"; }
join() { awk -v s="$1" 'NF || length { if (n++) printf "%s", s; printf "%s", $0 }'; }
body=$(mktemp)
head_line="执行者：GPT（CI 评审，mxgarage-vss-gpt）｜PR #$PR 独立复核"
footer="本评论由 GitHub Actions 里的 Codex（GPT 模型）在只读沙箱中生成；评审规则、提示词、必需检查清单与本发布脚本取自 main @ \`$RULES\`，PR 不能改自己的评审规则。结论只对上面这个 head 有效，head 变化后会重新评审。这是评审意见，不是合并决定。运行：$RUN_URL"

head_now() { rd "repos/$REPO/pulls/$PR" -q .head.sha; }
# 发评论：写入前最后一次核对 head（等检查可能等了很久），不一致就不发
post_comment() {
  local cur
  cur=$(head_now)
  if [ "$cur" != "$HEAD" ]; then
    echo "发布前核对：PR #$PR 的 head 已从 $HEAD 变为 $cur，不发布过时的评审"
    exit 0
  fi
  GH_TOKEN=$APP_TOKEN gh api -X POST "repos/$REPO/issues/$PR/comments" -F body=@"$1" > /dev/null
}
# 翻页取数组结果，输出合并后的 JSON 数组；任一页失败或结构不对返回非零。参数：路径、最多页数
fetch_pages() {
  # 每页先落盘再合并（不用 --argjson 传累积结果：大 PR 会超过单个参数的长度上限）
  local path=$1 max=$2 page=1 sep='?' dir f
  case "$path" in *\?*) sep='&' ;; esac
  dir=$(mktemp -d)
  while [ "$page" -le "$max" ]; do
    f="$dir/$(printf '%03d' "$page").json"
    rd "$path${sep}per_page=100&page=$page" > "$f" || return 1
    jq -e 'type == "array"' "$f" > /dev/null || return 1
    [ "$(jq length "$f")" -eq 100 ] || break
    page=$((page + 1))
  done
  jq -cs 'add' "$dir"/*.json || return 1
  rm -rf "$dir"
}

cur=$(head_now)
if [ "$cur" != "$HEAD" ]; then
  echo "PR #$PR 的 head 已从 $HEAD 变为 $cur，不发布过时的评审"
  exit 0
fi

# 去重：只有终局结论（pass / changes）才挡住同一 head 的重复发布
comments=$(fetch_pages "repos/$REPO/issues/$PR/comments" 10)
if jq -e --arg bot "$BOT_LOGIN" --arg re "^<!-- gpt-ci-review pr=$PR head=$HEAD verdict=(pass|changes) " \
  'any(.[]; .user.login == $bot and (.body | split("\n") | any(test($re))))' <<<"$comments" > /dev/null; then
  echo "本 App 已对 head $HEAD 发过终局评审，不重复发"
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
  printf '%s\n<!-- gpt-ci-review pr=%s head=%s verdict=error run=%s rules=%s -->\n\n**评审输出无效**：Codex 的输出不符合 schema，本次没有结论。请查看运行日志后重跑：`gh workflow run gpt-review.yml --ref main -f pr=%s`。\n\n---\n%s\n' \
    "$head_line" "$PR" "$HEAD" "$RUN_ID" "$RULES" "$PR" "$footer" > "$body"
  post_comment "$body"
  exit 1
fi

# PR 元数据：提交数与改动文件数，用来判断列表是否取全
prj=$(rd "repos/$REPO/pulls/$PR")
want_commits=$(jq -r '.commits' <<<"$prj")
want_files=$(jq -r '.changed_files' <<<"$prj")
# 取不到这两个数就按“列表取不全”处理（不放行）
case "$want_commits" in '' | *[!0-9]*) want_commits=999999 ;; esac
case "$want_files" in '' | *[!0-9]*) want_files=999999 ;; esac

# ---- 必需检查：来源绑定（App + 工作流 + head）、完成且成功、PR 未改动其工作流 ----
required=$(sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$REQUIRED_CHECKS_FILE" | sed '/^$/d')
files=$(fetch_pages "repos/$REPO/pulls/$PR/files" 30 || echo '')
checks_state() { # 输出 head 上全部 check run 的 JSON 数组；查询失败、结构不对或取不全时返回非零
  local page=1 total n=0 dir f
  dir=$(mktemp -d)
  while [ "$page" -le 10 ]; do
    f="$dir/$(printf '%03d' "$page").json"
    rd "repos/$REPO/commits/$HEAD/check-runs?per_page=100&page=$page" > "$f" || return 1
    jq -e '(.total_count | type) == "number" and (.check_runs | type) == "array"' "$f" > /dev/null || return 1
    total=$(jq '.total_count' "$f")
    n=$((n + $(jq '.check_runs | length' "$f")))
    if [ "$n" -ge "$total" ]; then jq -cs 'map(.check_runs) | add // []' "$dir"/*.json; rm -rf "$dir"; return 0; fi
    [ "$(jq '.check_runs | length' "$f")" -gt 0 ] || return 1
    page=$((page + 1))
  done
  return 1
}
gate() { # 输出不满足的必需检查说明（每行一条），空 = 全部满足。参数：checks_state 的输出（空 = 查询失败）
  local runs=$1 name app wf line pick run_id meta
  if [ -z "$runs" ]; then echo "检查结果查询失败、结构不对或不完整，无法核实"; return 0; fi
  if [ -z "$files" ] || [ "$(jq length <<<"$files")" -lt "$want_files" ]; then echo "PR 改动文件列表取不全，无法核实必需检查的工作流是否被改动"; fi
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    read -r name app wf <<<"$line"
    if [ -z "${wf:-}" ]; then echo "必需检查清单格式错误：$line"; continue; fi
    if [ -n "$files" ] && jq -e --arg wf "$wf" 'any(.[]; .filename == $wf or .previous_filename == $wf)' <<<"$files" > /dev/null; then
      echo "$name：PR 改动了它所在的工作流 $wf，本 PR 上的结果不可信，需维护者确认"
      continue
    fi
    # 只认预期 App 发出、且挂在本 head 上的同名检查；同名取最新一次
    pick=$(jq -c --arg n "$name" --arg app "$app" --arg h "$HEAD" '[.[] | select(.name == $n and (.app.slug // "") == $app and .head_sha == $h)] | sort_by(.started_at // "") | last' <<<"$runs")
    if [ "$pick" = "null" ]; then
      if jq -e --arg n "$name" 'any(.[]; .name == $n)' <<<"$runs" > /dev/null; then
        echo "$name：只有来源不符的同名检查（不是 $app 发出或不在本 head 上），不算"
      else
        echo "$name：缺失"
      fi
      continue
    fi
    if [ "$(jq -r .status <<<"$pick")" != "completed" ]; then echo "$name：未完成（$(jq -r .status <<<"$pick")）"; continue; fi
    if [ "$(jq -r .conclusion <<<"$pick")" != "success" ]; then echo "$name：未通过（$(jq -r .conclusion <<<"$pick")）"; continue; fi
    # 运行证据：检查所属的 Actions 运行必须是预期的工作流文件，且就是这个 head
    run_id=$(jq -r '.details_url // "" | capture("/actions/runs/(?<id>[0-9]+)").id // ""' <<<"$pick")
    if [ -z "$run_id" ]; then echo "$name：找不到对应的 Actions 运行，无法核实来源"; continue; fi
    if ! meta=$(rd "repos/$REPO/actions/runs/$run_id" -q '{path: (.path // ""), head_sha: (.head_sha // ""), check_suite_id: (.check_suite_id // 0), event: (.event // "")}'); then
      echo "$name：运行 $run_id 的来源查询失败，无法核实"
      continue
    fi
    if [ "$(jq -r '.path | sub("@.*$"; "")' <<<"$meta")" != "$wf" ]; then echo "$name：来自工作流 $(jq -r .path <<<"$meta")，不是 $wf"; continue; fi
    if [ "$(jq -r .head_sha <<<"$meta")" != "$HEAD" ]; then echo "$name：运行 $run_id 不在本 head 上"; continue; fi
    # details_url 是检查创建者自己填的，不能当来源证明：检查必须真的属于这次运行——
    # 它的 check suite 就是运行的 check suite，且运行的 job 里有同一个 check run（job 的 check_run_url 指向它）并且成功
    check_id=$(jq -r '.id // ""' <<<"$pick")
    if [ "$(jq -r '.check_suite.id // ""' <<<"$pick")" != "$(jq -r .check_suite_id <<<"$meta")" ]; then
      echo "$name：检查不属于运行 $run_id（check suite 不一致），详情链接不能作为来源证明"
      continue
    fi
    # 运行的 job 列表（一次最多 100 个；取不全按无法核实）
    if ! jobs=$(rd "repos/$REPO/actions/runs/$run_id/jobs?per_page=100" -q 'if (.jobs | type) == "array" and (.total_count | type) == "number" and .total_count <= (.jobs | length) then .jobs else error("incomplete") end'); then
      echo "$name：运行 $run_id 的 job 查询失败或不完整，无法核实"
      continue
    fi
    if ! jq -e --arg id "$check_id" --arg n "$name" 'type == "array" and any(.[]; ((.check_run_url // "") | endswith("/check-runs/" + $id)) and .name == $n and .conclusion == "success")' <<<"$jobs" > /dev/null; then
      echo "$name：运行 $run_id 里没有这个检查对应的成功 job，无法证明检查来自该运行"
      continue
    fi
    # 记录 CI 测的是什么：pull_request 事件测的是 head 与 base 的临时合并提交，其他事件（devloop 的手动触发、push）测的是 head 本身
    case "$(jq -r .event <<<"$meta")" in
      pull_request) printf '%s：运行 %s（pull_request，测的是本 head 与 base 的临时合并提交）\n' "$name" "$run_id" >> "$evidence" ;;
      *) printf '%s：运行 %s（%s，测的是本 head 本身）\n' "$name" "$run_id" "$(jq -r .event <<<"$meta")" >> "$evidence" ;;
    esac
  done <<<"$required"
}
waited=0
evidence=$(mktemp)
while :; do
  : > "$evidence"
  runs=$(checks_state || true)
  unmet=$(gate "$runs")
  # 只在“未完成 / 缺失”时继续等（检查可能还没开始或还在跑）；其他问题不会自己消失
  if [ -z "$unmet" ] || ! grep -qE '：未完成|：缺失' <<<"$unmet" || [ "$waited" -ge "$WAIT_SECONDS" ]; then break; fi
  sleep "$POLL_SECONDS"
  waited=$((waited + POLL_SECONDS))
done

# ---- 独立性：完整取到的提交里，Executor trailer 出现 GPT / dot / codex 说明实现者与本评审者同属一个体系（AGENTS §0） ----
indep=""
if commits=$(fetch_pages "repos/$REPO/pulls/$PR/commits" 3) && [ "$(jq length <<<"$commits")" -ge "$want_commits" ]; then
  executors=$(jq -r '[.[].commit.message | capture("(?m)^Executor: *(?<e>.*)$"; "g").e] | unique | join("；")' <<<"$commits")
  # 逐提交核对归属：任何一个提交没有 Executor trailer，实现者就无法核实（没找到同体系署名不等于确认非本体系）
  unsigned=$(jq -r '[.[] | select((.commit.message | test("(?m)^Executor: *\\S")) | not) | .sha[0:12]] | join("、")' <<<"$commits")
  if [ -n "$unsigned" ]; then
    indep="提交 $unsigned 没有 Executor trailer，无法核实实现者是否与评审者同属一个体系"
  elif grep -qiE 'gpt|dot|codex' <<<"$executors"; then
    indep="实现者（$executors）与本评审者同属 GPT 体系，本评审不算独立评审（AGENTS §0 / §8）"
  fi
else
  executors="未知"
  indep="提交列表取不全（PR 有 $want_commits 个提交），无法核对实现者是否与评审者同属一个体系"
fi

model_verdict=$(jq -r .verdict "$RESULT_FILE")
verdict=$model_verdict
reasons=""
# 模型给 pass 却列出 P1 / P2：自相矛盾，按 changes 处理（问题清单优先于结论字段）
if [ "$model_verdict" = "pass" ] && jq -e 'any(.findings[]; .severity == "P1" or .severity == "P2")' "$RESULT_FILE" > /dev/null; then
  verdict=changes
  reasons="模型给出 pass 但列出了 P1 / P2 问题，按问题清单处理"
fi
if [ "$verdict" = "pass" ]; then
  if [ -n "$unmet" ]; then verdict=blocked; reasons="必需检查未满足（等待 ${waited} 秒后）：$(join '；' <<<"$unmet")"; fi
  if [ -n "$indep" ]; then verdict=blocked; reasons="${reasons:+$reasons；}$indep"; fi
fi
checks_line=$(if [ -z "$required" ]; then echo "未登记必需检查"; elif [ -z "$unmet" ]; then echo "$(cut -d ' ' -f 1 <<<"$required" | join '、') 均来自预期的工作流、运行在本 head 上、完成且成功（$(join '；' < "$evidence")）"; else join '；' <<<"$unmet"; fi)

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
    (if $reasons != "" then "\n机器核对把模型给出的 `\($model)` 降为 `\($verdict)`：\($reasons | inline)。" else empty end),
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
