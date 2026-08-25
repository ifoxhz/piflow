#!/usr/bin/env bash
# Rebuild README demo GIF from docs/piFlow-full-middle-3x.mp4
# Two clips: 0–25s + 50s–end, keep 1 of every 4 frames (~4x), palette-compress.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="$ROOT/docs/piFlow-full-middle-3x.mp4"
OUT="$ROOT/docs/piFlow-full-middle-3x.gif"
WORK="${TMPDIR:-/tmp}/piflow-gif-$$"
mkdir -p "$WORK"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

A_END="${A_END:-25}"
B_START="${B_START:-50}"
FPS="${FPS:-8}"
WIDTH="${WIDTH:-960}"
COLORS="${COLORS:-128}"
VF="setpts=PTS/4,fps=${FPS},scale=${WIDTH}:-2:flags=lanczos"

echo "clip A  0-${A_END}s"
ffmpeg -hide_banner -y -ss 0 -t "$A_END" -i "$IN" -an -vf "$VF" -c:v libx264 -preset veryfast -crf 28 "$WORK/a.mp4"

echo "clip B  ${B_START}s-end"
ffmpeg -hide_banner -y -ss "$B_START" -i "$IN" -an -vf "$VF" -c:v libx264 -preset veryfast -crf 28 "$WORK/b.mp4"

printf "file '%s'\nfile '%s'\n" "$WORK/a.mp4" "$WORK/b.mp4" > "$WORK/list.txt"
echo "concat"
ffmpeg -hide_banner -y -f concat -safe 0 -i "$WORK/list.txt" -c copy "$WORK/ab.mp4"

echo "palette"
ffmpeg -hide_banner -y -i "$WORK/ab.mp4" \
  -vf "palettegen=max_colors=${COLORS}:stats_mode=diff" \
  "$WORK/palette.png"

echo "gif -> $OUT"
ffmpeg -hide_banner -y -i "$WORK/ab.mp4" -i "$WORK/palette.png" \
  -lavfi "paletteuse=dither=bayer:bayer_scale=5" \
  -loop 0 \
  "$OUT"

ls -lh "$OUT"
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT"
