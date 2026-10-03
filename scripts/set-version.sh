#!/bin/sh
# Propagate a release version into every file that hard-codes it.
#
#   Usage: sh scripts/set-version.sh 1.9.0
#
# Runs under POSIX sh + busybox sed (the alpine GitLab runner) — no jq, node
# or GNU-only flags. Uses `sed` (not awk) on purpose: sed only rewrites the
# matched substring and leaves the rest of each line — including its trailing
# CR — byte-for-byte intact. The tracked files use CRLF endings and there is
# no .gitattributes to normalize them, so this keeps diffs to the version line
# only instead of flipping every line to LF.
set -eu

V="${1:?usage: set-version.sh X.Y.Z}"
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || {
  echo "set-version: '$V' is not a plain X.Y.Z version"; exit 1; }

# package.json and tauri.conf.json each hold exactly one top-level "version".
sed -i 's/"version": "[^"]*"/"version": "'"$V"'"/' package.json
sed -i 's/"version": "[^"]*"/"version": "'"$V"'"/' src-tauri/tauri.conf.json

# package-lock.json has many "version" keys (one per dependency). Only the
# project's own version must change: the top-level one and packages[""].version,
# both of which appear BEFORE the first "node_modules/..." package entry. The
# 1,/node_modules/ address restricts the substitution to that leading region.
sed -i '1,/node_modules/ s/"version": "[^"]*"/"version": "'"$V"'"/' package-lock.json

# Inno Setup installer default (also overridable via /DMyAppVersion at build).
sed -i 's/^#define MyAppVersion "[^"]*"/#define MyAppVersion "'"$V"'"/' installer/reader-setup.iss

echo "set-version: set version to $V in package.json, package-lock.json, tauri.conf.json, reader-setup.iss"
