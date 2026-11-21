#!/usr/bin/env bash
# devloop 共享判断：claim.sh 与 publish.sh 都 source 本文件（均来自 main 上的可信版本）。由 claude.test.mjs 覆盖。

# devloop 自己的认领：由 Actions 发出、首行以“执行者：Claude（devloop 云端）”开头、带 devloop-claim 标记。只有这种评论不算他人 claim
DEVLOOP_SELF_CLAIM_JQ='((.author.login // "") | test("^github-actions(\\[bot\\])?$")) and (.body | startswith("执行者：Claude（devloop 云端）")) and (.body | contains("devloop-claim"))'
# 他人 claim：首行以“执行者：”开头且含 claim / 认领、且不是上面那种 devloop 自己的认领（正文引用 devloop 标记、或冒用 devloop 首行但不是 Actions 发的，都算他人）。
# 输入为 gh issue view --json comments 的 JSON，输出这些评论的链接（空格分隔，空 = 没有）
DEVLOOP_IS_OTHER_CLAIM_JQ="(($DEVLOOP_SELF_CLAIM_JQ) | not) and (.body | split(\"\\n\")[0] | test(\"^执行者：\") and test(\"claim|认领\"; \"i\"))"
DEVLOOP_OTHER_CLAIMS_JQ="[.comments[]? | select($DEVLOOP_IS_OTHER_CLAIM_JQ) | .url] | join(\" \")"

# 把多行按分隔符连成一行（paste -d 只支持单字节分隔符，中文分隔符会被截断）。参数：分隔符；stdin：多行
join_lines() { awk -v s="$1" 'NF || length { if (n++) printf "%s", s; printf "%s", $0 }'; }

# 冻结 spec：issue 正文的 sha256。stdin 为 gh issue view --json body 的 JSON
spec_hash() { jq -j '.body // ""' | sha256sum | cut -c1-64; }

# 机器强制的禁止路径（AGENTS 硬边界 + devloop 自身）：命中返回 0
forbidden_path() {
  case "$1" in
    *.glb | public/model/* | dist/* | .github/* | .openai/* | */.openai/* | \
      .env* | */.env* | .dev.vars* | */.dev.vars* | \
      package.json | package-lock.json | */package.json | */package-lock.json | \
      constitution.md | AGENTS.md | CLAUDE.md | .claude/* | scripts/devloop/* | wrangler.*)
      return 0 ;;
  esac
  return 1
}

# 全局互斥锁：仓库标签 devloop-lock。创建标签是原子操作（已存在则 422），描述记录持有者。
# 覆盖“核对 → 认领 → 实际执行 → 发布”整个生命周期：claim.sh 取得，publish.sh（或其失败步骤）释放。需要 REPO。
DEVLOOP_LOCK=devloop-lock
lock_owner() { echo "issue #$1 run $2"; }
lock_acquire() { gh api -X POST "repos/$REPO/labels" -f name="$DEVLOOP_LOCK" -f color=b60205 -f description="$(lock_owner "$1" "$2")" > /dev/null 2>&1; }
lock_holder() { gh api "repos/$REPO/labels/$DEVLOOP_LOCK" -q .description 2> /dev/null || echo "未知"; }
# 只释放自己持有的锁；锁不存在或属于别人时什么都不做
lock_release() {
  local d
  d=$(gh api "repos/$REPO/labels/$DEVLOOP_LOCK" -q .description 2> /dev/null) || return 0
  if [ "$d" = "$(lock_owner "$1" "$2")" ]; then gh api -X DELETE "repos/$REPO/labels/$DEVLOOP_LOCK" > /dev/null || true; fi
}

# 待推送提交（相对基线与 main 新增的提交）。参数：start main new
new_commits() { git rev-list "$3" --not "$1" "$2"; }

# 待推送内容涉及的路径（NUL 分隔原始路径）：相对 main 的净改动 + 每个待推送提交自己的改动（合并提交只看它自己引入的）
# 参数：start main new
changed_paths() {
  local c
  git diff -z --no-renames --name-only "$(git merge-base "$2" "$3")" "$3"
  for c in $(new_commits "$@"); do
    if [ "$(git rev-list --parents -n 1 "$c" | wc -w)" -gt 2 ]; then
      git diff-tree -z --cc --name-only --no-commit-id "$c"
    else
      git diff-tree -z -r --no-renames --name-only --no-commit-id "$c"
    fi
  done
}

_was_link() { [ "$(git --literal-pathspecs ls-tree "$1" -- "$2" | cut -d ' ' -f 1)" = "120000" ]; }

# 边界核对（publish 推送前、pack 上传前共用）：输出违规说明，每行一条；无输出 = 通过。参数：start main new
boundary_violations() {
  local c e p f
  changed_paths "$@" | while IFS= read -r -d '' f; do
    if [ -n "$f" ] && forbidden_path "$f"; then printf '禁止路径：%q\n' "$f"; fi
  done | LC_ALL=C sort -u
  for c in $(new_commits "$@"); do
    git ls-tree -r -z "$c" | while IFS= read -r -d '' e; do
      [ "${e%% *}" = "120000" ] || continue
      p=${e#*$'\t'}
      _was_link "$1" "$p" || _was_link "$2" "$p" || printf '符号链接：%q\n' "$p"
    done
  done | LC_ALL=C sort -u
  for c in $(new_commits "$@"); do
    git show -s --format=%B "$c" | grep -x 'Executor: Claude（devloop 云端）' > /dev/null || printf '缺少 Executor trailer：%s\n' "$c"
  done
}

# 冻结文件范围：任务 issue 正文里 ```devloop-scope 代码块的每一行（bash 模式，* 可跨目录；# 开头为注释）。
# 正文由 spec 哈希冻结，所以范围随 spec 冻结。stdin 为 gh issue view --json body 的 JSON；输出模式，每行一个
scope_patterns() {
  jq -r '.body // ""' | tr -d '\r' | awk '/^```devloop-scope[[:space:]]*$/ { f = 1; next } f && /^```/ { f = 0 } f { gsub(/^[ \t]+|[ \t]+$/, ""); if ($0 != "" && $0 !~ /^#/) print }'
}
# 路径是否落在声明的范围里（只看声明的模式）。参数：路径、模式文件
in_declared_scope() {
  local p
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    # shellcheck disable=SC2254 # 有意把模式当 glob 用
    case "$1" in $p) return 0 ;; esac
  done < "$2"
  return 1
}
# 允许改动的范围：声明的范围 + 测试（tests/、*.test.*）
in_scope() {
  case "$1" in tests/* | *.test.*) return 0 ;; esac
  in_declared_scope "$1" "$2"
}
# 越出冻结文件范围的路径，每行一条。参数：start main new 模式文件 [pr]（pr：另外允许 PR 在 start 时已改动的文件，用于修复）
scope_violations() {
  local allowed f
  allowed=$(mktemp)
  if [ "${5:-}" = "pr" ]; then git diff -z --no-renames --name-only "$(git merge-base "$2" "$1")" "$1" > "$allowed"; fi
  changed_paths "$1" "$2" "$3" | while IFS= read -r -d '' f; do
    [ -n "$f" ] || continue
    if in_scope "$f" "$4" || grep -qzxF -- "$f" "$allowed"; then continue; fi
    printf '超出冻结文件范围：%q\n' "$f"
  done | LC_ALL=C sort -u
  rm -f "$allowed"
}

# 外部认领冲突（需要 gh 与 REPO）：输出冲突说明，每行一条。参数：模式文件、本任务 issue 号
#  - 其他执行者的开放 PR（非 devloop 分支）改动的文件落在本任务声明的范围里；
#  - 其他 issue 上他人的 claim 正文提到本范围的路径（取每个模式里第一个通配符之前、至少 3 个字符的字面部分）。
#  只能发现已开 PR 或在 claim 里写明路径的冲突；语义冲突（共享类型、接口等）靠评审。
external_conflicts() {
  local pf=$1 n=$2 num f
  gh pr list -R "$REPO" --state open --limit 100 --json number,headRefName,files \
    | jq -r '.[] | select((.headRefName | test("claude-devloop$")) | not) | .number as $n | .files[]? | "\($n)\t\(.path | @json)"' \
    | while IFS=$'\t' read -r num f; do
      f=$(jq -r . <<<"$f")
      if in_declared_scope "$f" "$pf"; then printf '其他执行者的开放 PR #%s 改动了范围内的 %q\n' "$num" "$f"; fi
    done | LC_ALL=C sort -u
  gh issue list -R "$REPO" --state open --limit 100 --json number,comments \
    | jq -r --rawfile pats "$pf" --arg n "$n" "
      (\$pats | split(\"\\n\") | map(select(length > 0) | sub(\"[*?\\\\[].*\$\"; \"\")) | map(select(length >= 3))) as \$lits
      | .[] | select((.number | tostring) != \$n) | .number as \$i
      | .comments[]? | select($DEVLOOP_IS_OTHER_CLAIM_JQ) | .body as \$b
      | select(any(\$lits[]; . as \$l | \$b | contains(\$l)))
      | \"issue #\\(\$i) 上他人的 claim 提到了本任务范围的路径：\\(.url)\"" | LC_ALL=C sort -u
}

# 可信评审：PR 上由仓库所有者账号发出、首行以“执行者：GPT”开头的最新一条评论。stdin 为 gh pr view --json comments；参数：所有者登录名
# 输出两行：评论链接、正文 sha256（没有则输出空）
trusted_review() {
  local j sel url
  j=$(cat)
  sel='[.comments[]? | select((.author.login // "") == $o and (.body | startswith("执行者：GPT")))] | last'
  url=$(jq -r --arg o "$1" "$sel | .url // \"\"" <<<"$j")
  [ -n "$url" ] || return 0
  printf '%s\n' "$url"
  jq -j --arg o "$1" "$sel | .body" <<<"$j" | sha256sum | cut -c1-64
}

# 本次运行的 claim：某个对象的评论里由 Actions 发出、带 run=<id> 的 devloop-claim。stdin 为 gh ... --json comments。输出匹配条数
own_claims() { jq -r --arg m "devloop-claim run=$1 " '[.comments[]? | select((.author.login | test("^github-actions(\\[bot\\])?$")) and (.body | contains($m)))] | length'; }
# issue 上最近一次 devloop 实现 claim 记录的 spec 哈希（没有则空）。stdin 为 gh issue view --json comments
claimed_spec() { jq -r '[.comments[]? | select((.author.login | test("^github-actions(\\[bot\\])?$")) and (.body | startswith("执行者：Claude（devloop 云端）")) and (.body | contains("devloop-claim")) and ((.body | contains(" issue=")) | not))] | last | (.body // "") | (capture("spec=(?<s>[0-9a-f]{64})").s // "")'; }
