#!/usr/bin/env bash
# devloop 共享判断：claim.sh 与 publish.sh 都 source 本文件（均来自 main 上的可信版本）。由 claude.test.mjs 覆盖。

# 他人 claim：首行以“执行者：”开头且含 claim / 认领、不是 devloop 自己的认领标记的评论。输入为 gh issue view --json comments 的 JSON，输出这些评论的链接（空格分隔，空 = 没有）
DEVLOOP_OTHER_CLAIMS_JQ='[.comments[]? | select((.body | contains("devloop-claim")) | not) | select(.body | split("\n")[0] | test("^执行者：") and test("claim|认领"; "i")) | .url] | join(" ")'

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

# 修复的冻结文件范围：PR 在开工时（start）已改动的文件，加上 tests/、docs/ 与 *.test.*。输出越界路径，每行一条。参数：start main new
scope_violations() {
  local allowed f
  allowed=$(mktemp)
  git diff -z --no-renames --name-only "$(git merge-base "$2" "$1")" "$1" > "$allowed"
  changed_paths "$@" | while IFS= read -r -d '' f; do
    [ -n "$f" ] || continue
    case "$f" in tests/* | docs/* | *.test.*) continue ;; esac
    grep -qzxF -- "$f" "$allowed" || printf '超出冻结文件范围：%q\n' "$f"
  done | LC_ALL=C sort -u
  rm -f "$allowed"
}

# 本次运行的 claim：某个对象的评论里由 Actions 发出、带 run=<id> 的 devloop-claim。stdin 为 gh ... --json comments。输出匹配条数
own_claims() { jq -r --arg m "devloop-claim run=$1 " '[.comments[]? | select((.author.login | test("^github-actions(\\[bot\\])?$")) and (.body | contains($m)))] | length'; }
# issue 上最近一次 devloop 实现 claim 记录的 spec 哈希（没有则空）。stdin 为 gh issue view --json comments
claimed_spec() { jq -r '[.comments[]? | select((.author.login | test("^github-actions(\\[bot\\])?$")) and (.body | contains("devloop-claim")) and ((.body | contains(" issue=")) | not))] | last | (.body // "") | (capture("spec=(?<s>[0-9a-f]{64})").s // "")'; }
