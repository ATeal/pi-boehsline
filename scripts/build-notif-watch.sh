#!/usr/bin/env bash
# Build bin/notif-watch from native/notif-watch/notif-watch.swift (macOS only).
#
# watch.ts spawns the binary for Mac and iPhone notifications; `swift` as a
# script is too slow to start. The build is skipped when bin/notif-watch was
# made from this exact source (sha in bin/.notif-watch.sha). FORCE=1 rebuilds.
#
# Exit codes: 0 built or current, 2 not macOS or no swiftc, 1 build failed.
set -euo pipefail
cd "$(dirname "$0")/.."
src=native/notif-watch/notif-watch.swift
out=bin/notif-watch
stamp=bin/.notif-watch.sha

[ "$(uname -s)" = Darwin ] || { echo "notif-watch: macOS only" >&2; exit 2; }
command -v swiftc >/dev/null || { echo "notif-watch: swiftc not found (xcode-select --install)" >&2; exit 2; }

sha=$(shasum -a 256 "$src" | cut -d' ' -f1)
if [ -z "${FORCE:-}" ] && [ -x "$out" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$sha" ]; then
  echo "notif-watch: up to date"
  exit 0
fi

mkdir -p bin
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# swiftc wants a .swift name; the source keeps its shebang so it also runs as a script.
cp "$src" "$tmp/notif-watch.swift"
swiftc -O "$tmp/notif-watch.swift" -o "$tmp/notif-watch"
mv "$tmp/notif-watch" "$out"
echo "$sha" > "$stamp"
echo "notif-watch: built $out"
