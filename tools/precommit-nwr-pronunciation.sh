#!/bin/sh
# Pre-commit guard for the bundled VT Paul pronunciation snapshot: the STAGED
# assets/nwr-pronunciation/ must be self-consistent (index.json matches the staged set
# files), or CI's nwr-pronunciation-data test fails. It checks the staged copies, not the
# working tree, because a half-staged sync is the usual way to break it.
#
#   tools/precommit-nwr-pronunciation.sh         check only if the commit touches the folder
#   tools/precommit-nwr-pronunciation.sh --all   check the staged folder regardless
#
# Called from .git/hooks/pre-commit.

dir=assets/nwr-pronunciation
root=$(git rev-parse --show-toplevel) || exit 1

if [ "$1" != "--all" ] && git diff --cached --quiet -- "$dir"; then
    exit 0
fi

if ! command -v node >/dev/null 2>&1; then
    echo "nwr-pronunciation: node not found, cannot check the staged snapshot" >&2
    exit 1
fi

tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT

(cd "$root" && git ls-files -z -- "$dir" | xargs -0 git checkout-index --prefix="$tmp/" --) || exit 1

if ! node --no-warnings "$root/tools/sync-nwr-pronunciation.mjs" --check --dir "$tmp/$dir"; then
    echo "" >&2
    echo "The staged $dir/ is inconsistent: index.json and the set files come from different syncs." >&2
    echo "Stage the whole folder after a sync, then commit again:" >&2
    echo "    node tools/sync-nwr-pronunciation.mjs --reindex" >&2
    echo "    git add $dir" >&2
    exit 1
fi
exit 0
