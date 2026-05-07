#!/usr/bin/env bash
# Build the Node-server sidecar as a single executable and place it in
# `desktop/crates/gui/binaries/` under the file name Tauri's `externalBin`
# resolver expects: `<base>-<rust-target-triple>` (with `.exe` on Windows).
#
# Default: build for the host triple. Pass `--all` to cross-compile for
# every supported platform (used by CI) or `--target <triple>` for a
# specific one.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENTRYPOINT="$REPO_ROOT/server/index.ts"
OUT_DIR="$REPO_ROOT/desktop/crates/gui/binaries"
BASE_NAME="statewave-admin-server"

mkdir -p "$OUT_DIR"

# Map a Rust target triple → bun's `--target=` value and a binary suffix.
bun_target_for() {
    case "$1" in
        aarch64-apple-darwin)        echo "bun-darwin-arm64";;
        x86_64-apple-darwin)         echo "bun-darwin-x64";;
        x86_64-unknown-linux-gnu)    echo "bun-linux-x64";;
        aarch64-unknown-linux-gnu)   echo "bun-linux-arm64";;
        x86_64-pc-windows-msvc)      echo "bun-windows-x64";;
        *) echo ""; return 1;;
    esac
}

binary_suffix_for() {
    case "$1" in
        *windows*) echo ".exe";;
        *) echo "";;
    esac
}

host_triple() {
    rustc -vV | awk -F': ' '/^host:/ {print $2}'
}

build_one() {
    local triple="$1"
    local bun_t suffix outpath
    bun_t="$(bun_target_for "$triple")" || {
        echo "unsupported triple: $triple" >&2
        return 1
    }
    suffix="$(binary_suffix_for "$triple")"
    outpath="$OUT_DIR/${BASE_NAME}-${triple}${suffix}"
    echo "→ $triple ($bun_t) → $outpath"
    bun build "$ENTRYPOINT" \
        --compile \
        --target="$bun_t" \
        --outfile="$outpath" \
        --minify >/dev/null
    chmod +x "$outpath"
}

case "${1:-}" in
    --all)
        for t in \
            aarch64-apple-darwin \
            x86_64-apple-darwin \
            x86_64-unknown-linux-gnu \
            aarch64-unknown-linux-gnu \
            x86_64-pc-windows-msvc; do
            build_one "$t"
        done
        ;;
    --target)
        build_one "$2"
        ;;
    "")
        build_one "$(host_triple)"
        ;;
    *)
        echo "usage: $0 [--all | --target <rust-triple>]" >&2
        exit 1
        ;;
esac

echo
echo "Built sidecars in $OUT_DIR:"
ls -lh "$OUT_DIR" | tail -n +2
