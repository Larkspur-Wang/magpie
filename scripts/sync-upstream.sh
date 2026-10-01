#!/bin/sh
# Take in upstream yetone/magpie on this fork's product branch, feat/mirasim.
#
#   scripts/sync-upstream.sh --check    what upstream has that feat/mirasim doesn't
#   scripts/sync-upstream.sh            mirror main, merge upstream, test, push
#   scripts/sync-upstream.sh --install  … then build and install the Mirasim
#                                       edition, tag and push
#
# A merge that conflicts stops here: resolve it, commit, run this again.
# main is upstream's main exactly (fast-forward only); feat/mirasim is
# upstream plus our commits, merged, never rebased, so nothing is
# force-pushed. Installed builds are tagged mirasim-<upstream tag>.<n>.
set -eu
cd "$(dirname "$0")/.."

BRANCH=feat/mirasim
UPSTREAM=https://github.com/yetone/magpie.git
APP="/Applications/Magpie Mirasim.app"
ANTIGRAVITY=${MAGPIE_ANTIGRAVITY_ROOT:-$(cd .. && pwd)/magpie-antigravity-auth}
mode=${1:-}

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'sync-upstream: %s\n' "$*" >&2; exit 1; }

case "$mode" in "" | --check | --install) ;; *) die "usage: $0 [--check|--install]" ;; esac
[ "$(git branch --show-current)" = "$BRANCH" ] || die "switch to $BRANCH first"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "commit or stash local changes first"

git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM"
git remote set-url --push upstream DISABLED
git fetch --quiet --tags upstream
git fetch --quiet origin

new=$(git rev-list --count HEAD..upstream/main)
say "upstream/main is $(git describe --tags upstream/main); $new commit(s) not yet in $BRANCH"
if [ "$mode" = --check ]; then
  git log --oneline --no-decorate HEAD..upstream/main | head -40
  # The Antigravity community plugin handles Google sign-ins: it stays at
  # the commit plugins/antigravity/README.md pins until that is reviewed.
  if [ -d "$ANTIGRAVITY/.git" ]; then
    git -C "$ANTIGRAVITY" fetch --quiet origin
    ahead=$(git -C "$ANTIGRAVITY" rev-list --count HEAD..origin/HEAD)
    say "Antigravity community plugin: $ahead commit(s) past the pinned $(git -C "$ANTIGRAVITY" rev-parse --short HEAD) (review before moving the pin)"
  fi
  exit 0
fi

say "mirror upstream/main to origin/main"
git push --quiet origin upstream/main:refs/heads/main || die "origin/main has commits upstream doesn't: it must stay a mirror"
git update-ref refs/heads/main upstream/main

if [ "$new" -gt 0 ]; then
  say "merge upstream/main"
  git merge --no-edit -m "merge: upstream $(git describe --tags upstream/main)" upstream/main ||
    die "merge conflicts: resolve them (git status), git commit, then run $0 ${mode} again"
fi

say "test (vet, go test, race, plugins)"
go vet ./...
go test ./...
go test -race ./internal/gateway/ ./internal/redact/
node --test plugins/*/*.test.mjs
CGO_ENABLED=0 go build -tags nogui -o /dev/null .

say "push $BRANCH"
git push --quiet origin "$BRANCH"

[ "$mode" = --install ] || { say "done: run $0 --install to build and install it"; exit 0; }

say "build and install the Mirasim edition"
sh build/mirasim-app.sh
mkdir -p "$HOME/Library/Caches/magpie-mirasim"
if [ -d "$APP" ]; then
  ditto -c -k --keepParent "$APP" "$HOME/Library/Caches/magpie-mirasim/previous.zip"
  osascript -e 'quit app id "com.larkspur.magpie.mirasim"' >/dev/null 2>&1 || true
  sleep 2
  pkill -f "$APP/Contents/MacOS/magpie" 2>/dev/null || true
  rm -rf "$APP"
fi
ditto magpie.app "$APP"
open "$APP"

base=$(git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD)
n=$(( $(git tag -l "mirasim-$base.*" | wc -l) + 1 ))
tag="mirasim-$base.$n"
git tag -a "$tag" -m "Magpie Mirasim on upstream $base ($(git rev-parse --short HEAD))"
git push --quiet origin "refs/tags/$tag"
say "installed $("$APP/Contents/MacOS/magpie" version 2>/dev/null || echo "$APP") as $tag"
say "previous build kept at ~/Library/Caches/magpie-mirasim/previous.zip"
