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
