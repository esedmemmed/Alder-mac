#!/bin/bash
# Usage: measure.sh <label> <link-or-file> [bare|shell-hidden|shell-shown]
# Plays fullscreen and writes ~/AlderProof/results/<label>.<mode>.{tsv,summary.txt,machine.txt},
# none of which holds the link. Player output, which does, stays in ~/AlderProof/logs/.
# Bash 3.2 compatible. Environment overrides, for tests: ALDERPROOF_DIR, MPV_BIN, ALDERPROOF_BIN,
# MEASURE_END (seconds, default 600), MEASURE_EXTRA (extra player arguments).
set -u

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
    echo "usage: measure.sh <label> <link-or-file> [bare|shell-hidden|shell-shown]" >&2
    exit 64
fi
label=$1
link=${2%$'\r'}
mode=${3:-bare}
case $label in
    ''|*[!A-Za-z0-9._-]*) echo "label may hold only letters, digits, dot, dash, underscore" >&2; exit 64 ;;
esac
case $mode in
    bare|shell-hidden|shell-shown) ;;
    *) echo "mode must be bare, shell-hidden or shell-shown" >&2; exit 64 ;;
esac
if [ -z "$link" ]; then
    echo "no link: is the label in ~/AlderProof/links.txt?" >&2
    exit 64
fi

here=$(cd "$(dirname "$0")" && pwd)
dir=${ALDERPROOF_DIR:-$HOME/AlderProof}
results=$dir/results
logs=$dir/logs
end=${MEASURE_END:-600}
mkdir -p "$results" "$logs" || exit 1
dir_abs=$(cd "$dir" && pwd)
results=$dir_abs/results

# Git Bash on Windows only: a native mpv needs native paths.
native() {
    if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi
}
fact() {
    out=$("$@" 2>/dev/null | head -n 1) || out=
    printf '%s\n' "${out:-unavailable}"
}

stem=$results/$label.$mode
{
    echo "product_version=$(fact sw_vers -productVersion)"
    echo "build=$(fact sw_vers -buildVersion)"
    echo "model=$(fact sysctl -n hw.model)"
    echo "ram_bytes=$(fact sysctl -n hw.memsize)"
    echo "power=$(fact pmset -g ps)"
} > "$stem.machine.txt"
if grep -q "Battery Power" "$stem.machine.txt"; then
    echo "warning: on battery; plug in the charger and run this again" >&2
fi
rm -f "$stem.summary.txt"

log=$logs/$label.$mode.player.log
script=$(native "$here/measure.lua")
opts="measure-label=$label,measure-mode=$mode,measure-dir=$(native "$results")"

case $mode in
    bare)
        mpv=${MPV_BIN:-$dir/mpv/mpv.app/Contents/MacOS/mpv}
        [ -x "$mpv" ] || mpv=$(command -v mpv) || { echo "mpv not found; see RECIPE.md step 2" >&2; exit 69; }
        # shellcheck disable=SC2086  # MEASURE_EXTRA is deliberately split into arguments
        # vo=libmpv is cocoa-cb, macOS mpv's only native video path; --vo=gpu gave sound only on the Air (T7.1.1).
        "$mpv" --no-config --fs --vo=libmpv --hwdec=videotoolbox --framedrop=vo --end="$end" \
            --script="$script" --script-opts="$opts" ${MEASURE_EXTRA:-} "$link" > "$log" 2>&1
        ;;
    shell-*)
        app=${ALDERPROOF_BIN:-$dir/AlderProof.app/Contents/MacOS/AlderProof}
        [ -x "$app" ] || { echo "AlderProof not found at $app" >&2; exit 69; }
        "$app" --url "$link" --overlay "${mode#shell-}" --end "$end" \
            --measure "$script" --label "$label" > "$log" 2>&1
        ;;
esac
rc=$?

# The player log holds the link and is deleted by the helper: keep its warnings, links cut, beside the results.
grep -iE 'error|fail|warn|vo/|hwdec|video|measure|lua|script' "$log" 2>/dev/null     | sed -E 's#[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]]*#[link]#g' | tail -n 60 > "$stem.diag.txt"
[ -f "$results/$label.$mode.tsv" ] || echo "no tsv: the measure script did not load; see $stem.diag.txt" >&2
if [ -f "$stem.summary.txt" ]; then
    cat "$stem.summary.txt"
    grep -E '^(product_version|model)=' "$stem.machine.txt"
else
    echo "no summary was written; the player stopped early" >&2
fi
if [ "$rc" -ne 0 ]; then
    echo "player exit code $rc. $log holds its output and the link: read it here, never send it." >&2
fi
exit "$rc"
