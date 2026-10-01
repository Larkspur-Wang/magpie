#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# mirasim-<upstream tag>+<commit>: the upstream release this build is on.
# It must never parse as a semver release (internal/update.Released), or
# the official updater would replace this build with the official app.
base=$(git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD 2>/dev/null || echo v0.0.0)
dirty=$(git diff --quiet HEAD -- . ':!*.md' 2>/dev/null || echo "-dirty")
version="mirasim-${base}+$(git rev-parse --short HEAD)${dirty}"
make app VERSION="$version"
plist=magpie.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Magpie Mirasim' "$plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName Magpie Mirasim' "$plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.larkspur.magpie.mirasim' "$plist"
# Leave the official app's import URL association alone.
/usr/libexec/PlistBuddy -c 'Delete :CFBundleURLTypes' "$plist"
codesign --force --deep --sign - magpie.app
printf '%s\n' "Built Magpie Mirasim ($version); local ad-hoc signature, not notarized."
