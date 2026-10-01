#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
version="mirasim-dev-$(git rev-parse --short HEAD)"
make app VERSION="$version"
plist=magpie.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Magpie Mirasim' "$plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName Magpie Mirasim' "$plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.larkspur.magpie.mirasim' "$plist"
# Leave the official app's import URL association alone.
/usr/libexec/PlistBuddy -c 'Delete :CFBundleURLTypes' "$plist"
codesign --force --deep --sign - magpie.app
printf '%s\n' "Built Magpie Mirasim ($version); local ad-hoc signature, not notarized."
