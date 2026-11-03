#!/bin/sh
# 校验 PR 内每个 commit 的消息：type(scope): 摘要
# 用法：tools/ci/check_commits.sh origin/main
set -u
base="${1:-origin/main}"
fail=0
for sha in $(git rev-list --no-merges "$base..HEAD"); do
  msg=$(git log -1 --format=%s "$sha")
  if ! printf '%s' "$msg" | grep -qE '^(feat|fix|polish|docs|test|chore)(\([^)]+\))?: .+'; then
    echo "::error::$sha 提交信息不符合 type(scope): 摘要 —— $msg"
    fail=1
  fi
  if printf '%s' "$msg" | grep -qiE '^(wip|update|updates|misc|fix|test|改动|修复)$'; then
    echo "::error::$sha 提交信息无信息量 —— $msg"
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "提交信息检查通过"
exit "$fail"