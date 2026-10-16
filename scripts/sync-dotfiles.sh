#!/usr/bin/env bash
# Pull new dotfiles commits for the extensions that moved here, with history.
#
# Filters a fresh clone of dotfiles down to scripts/dotfiles-paths.txt (current
# and former names), maps .pi-agent/{extensions,test}/ to {extensions,test}/,
# and merges the result. git filter-repo is deterministic, so commits that were
# already imported get the same IDs and only new ones come in.
#
# Only committed work comes across. Run this until dotfiles stops carrying these
# files (migration step 9), then delete it.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
src=${DOTFILES:-$HOME/Code/github.com/ericboehs/dotfiles}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"; git -C "$here" remote remove dotfiles-import 2>/dev/null || true' EXIT

git clone -q --no-local "$src" "$tmp/df"
git -C "$tmp/df" filter-repo --force --quiet \
  --paths-from-file "$here/scripts/dotfiles-paths.txt" \
  --path-rename .pi-agent/extensions/:extensions/ \
  --path-rename .pi-agent/test/:test/
gitleaks git "$tmp/df" --no-banner >/dev/null

branch=$(git -C "$tmp/df" branch --show-current)
git -C "$here" remote add dotfiles-import "$tmp/df"
git -C "$here" fetch -q dotfiles-import
new=$(git -C "$here" rev-list --count "HEAD..dotfiles-import/$branch")
if [ "$new" = 0 ]; then echo "Up to date."; exit 0; fi
git -C "$here" merge --no-edit -m "chore: sync $new dotfiles commit(s) for moved extensions" "dotfiles-import/$branch"
echo "Merged $new commit(s)."
