#!/bin/zsh
# Rendrer alle alternativer og vinkler (tools/render/shots.json) til public/renders/*.jpg.
#   tools/render/render_all.sh [variant ...]     (standard: alle eksporterte)
# Forutsetter: fetch_assets.py, prep_library.py og gen_trees.py er kjørt, og export.mjs har laget scenene.
set -e
cd "$(dirname "$0")/../.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
WORK=${HYTTE_RENDER_WORK:-$HOME/.cache/hytte3d-render/scenes}
RES=${RES:-1920x1080}; SAMPLES=${SAMPLES:-160}
mkdir -p public/renders /tmp/hytte-render
variants=("$@"); [ ${#variants} -eq 0 ] && variants=($(ls $WORK))
for v in $variants; do
  shots=($(python3 -c "import json,sys; s=json.load(open('tools/render/shots.json'))['sets']; print(' '.join(s.get('$v', s['default'])))"))
  for s in $shots; do
    out=public/renders/${v}_${s}.jpg
    [ -f "$out" ] && [ -z "$FORCE" ] && { echo "finnes: $out"; continue; }
    echo "== $v $s"
    "$BLENDER" -b --factory-startup -P tools/render/render.py -- --scene $WORK/$v --shot $s --out /tmp/hytte-render/${v}_${s}.png --res $RES --samples $SAMPLES > /tmp/hytte-render/${v}_${s}.log 2>&1 || { echo "FEIL $v $s"; tail -5 /tmp/hytte-render/${v}_${s}.log; continue; }
    sips -s format jpeg -s formatOptions 88 /tmp/hytte-render/${v}_${s}.png --out "$out" >/dev/null
    echo "   -> $out"
  done
done
