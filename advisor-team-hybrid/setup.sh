#!/usr/bin/env bash
# Materialize this bundle in place: replace the __PRESET_DIR__ placeholder with
# this directory's absolute path, so the persona and role prompts reference the
# real location.
#
# DSH cannot compute that path for us: `!!js` expressions are rejected inside a
# preset's nested `config` (the installer parses the patch as plain YAML), and a
# relative plugin path does not resolve from a preset row. Hence one explicit,
# verifiable substitution before install.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$DIR/cordis.patch.yml"

if ! grep -q '__PRESET_DIR__' "$TARGET"; then
  echo "nothing to do: no __PRESET_DIR__ placeholder in $TARGET"
  echo "current preset dir is: $DIR"
  exit 0
fi

# Only rewrite the literal placeholder; every other byte is preserved.
python3 - "$TARGET" "$DIR" <<'PY'
import sys, pathlib
path, directory = pathlib.Path(sys.argv[1]), sys.argv[2]
text = path.read_text(encoding='utf-8')
path.write_text(text.replace('__PRESET_DIR__', directory), encoding='utf-8')
print(f'set __PRESET_DIR__ -> {directory}')
PY

echo "verify: $(grep -c "$DIR" "$TARGET") reference(s) now point at this directory"
