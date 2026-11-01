#!/usr/bin/env bash
# Builds the website: the live app from main at the root, plus a preview of
# every open pull request at /preview/<branch>/. Each preview is the PR branch
# merged with the latest main, so it shows exactly what merging would ship.
#
# Needs: a full git clone (all branches) and GH_TOKEN for listing pull requests.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
OUT="$ROOT/dist"
cd "$ROOT"

echo "::group::Build main"
npm ci
npm test
npm run build
echo "::endgroup::"

git config user.name "github-actions"
git config user.email "github-actions@users.noreply.github.com"

# Same-repository pull requests only: never build code from forks.
prs=$(gh pr list --state open --json number,headRefName,isCrossRepository \
  --jq '.[] | select(.isCrossRepository == false) | "\(.number) \(.headRefName)"')

: > "$ROOT/previews.txt"
while read -r number branch; do
  [ -z "${number:-}" ] && continue
  slug=$(echo "${branch#claude/}" | sed 's/[^a-zA-Z0-9-]/-/g')
  dir="/tmp/pr-$number"
  echo "::group::Preview #$number ($branch)"
  rm -rf "$dir"
  git worktree add --detach "$dir" "origin/$branch"
  if ! git -C "$dir" merge --no-edit origin/main >/dev/null; then
    echo "::warning::PR #$number conflicts with main; no preview built."
    git -C "$dir" merge --abort || true
    echo "::endgroup::"
    continue
  fi
  (
    cd "$dir"
    npm ci
    VITE_PREVIEW="$slug" npx vite build --outDir "$OUT/preview/$slug" --emptyOutDir
  ) || { echo "::warning::Preview for PR #$number failed to build."; echo "::endgroup::"; continue; }
  echo "$number $slug" >> "$ROOT/previews.txt"
  echo "::endgroup::"
done <<< "$prs"

echo "Built previews:"
cat "$ROOT/previews.txt"
