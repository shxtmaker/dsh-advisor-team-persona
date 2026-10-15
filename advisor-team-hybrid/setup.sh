#!/usr/bin/env bash
# Materialize this bundle in place: replace the __PRESET_DIR__ placeholder with
# this directory's absolute path, everywhere it appears.
#
# DSH cannot compute that path for us: `!!js` expressions are rejected inside a
# preset's nested `config` (the installer parses the patch as plain YAML), and a
# relative plugin path does not resolve from a preset row. Hence one explicit,
# verifiable substitution before install.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Scan every text file in the bundle rather than a hard-coded list: a placeholder
# left behind is a path the model cannot read, and it fails silently — the preset
# still mounts and reports no error. This script excludes itself, since it names
# the placeholder in its own source.
SELF="$(basename "${BASH_SOURCE[0]}")"
mapfile -t FILES < <(grep -rl '__PRESET_DIR__' "$DIR" \
  --include='*.yml' --include='*.md' --include='*.json' --include='*.js' 2>/dev/null \
  | grep -v "/$SELF$" || true)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "nothing to do: no __PRESET_DIR__ placeholder found"
  echo "current preset dir is: $DIR"
  exit 0
fi

# Only rewrite the literal placeholder; every other byte is preserved.
python3 - "$DIR" "${FILES[@]}" <<'PY'
import sys, pathlib
directory, files = sys.argv[1], sys.argv[2:]
total = 0
for name in files:
    path = pathlib.Path(name)
    text = path.read_text(encoding='utf-8')
    count = text.count('__PRESET_DIR__')
    if count == 0:
        continue
    path.write_text(text.replace('__PRESET_DIR__', directory), encoding='utf-8')
    total += count
    print(f'  {path.relative_to(directory)}: {count} reference(s)')
print(f'set __PRESET_DIR__ -> {directory} ({total} total)')
PY

# Fail loudly if anything is still unresolved.
LEFT="$(grep -rl '__PRESET_DIR__' "$DIR" 2>/dev/null | grep -v "/$SELF$" || true)"
if [ -n "$LEFT" ]; then
  echo "ERROR: placeholders remain in:" >&2
  echo "$LEFT" >&2
  exit 1
fi
echo "ok: every placeholder resolved; no absolute path is left broken in this bundle"
