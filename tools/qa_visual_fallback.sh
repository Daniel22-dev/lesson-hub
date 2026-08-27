#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RESULTS=$(mktemp -d "${TMPDIR:-/tmp}/lesson-hub-visual.XXXXXX")
IDS="$RESULTS/ids.txt"
cleanup() { rm -rf "$RESULTS"; }
trap cleanup EXIT INT TERM
python3 - "$ROOT" > "$IDS" <<'PY'
import json,sys
root=sys.argv[1]
for item in json.load(open(root + '/qa/visual-plan.json'))['scenarios']:
    print(item['id'])
PY
cat "$IDS" | xargs -I{} -P8 sh -c 'OUT="$2/$1.json"; timeout 90s python3 "$0/tools/qa_visual_scenario.py" "$1" "$OUT" || test -s "$OUT"' "$ROOT" {} "$RESULTS"
python3 "$ROOT/tools/qa_visual_collect.py" "$RESULTS"
