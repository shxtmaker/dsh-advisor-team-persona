#!/usr/bin/env bash
# Materialize this preset in place: replace the __PRESET_DIR__ placeholder with
# this directory's absolute path, everywhere it appears.
#
# Files that carry the placeholder:
#   cordis.patch.yml            the skill provider's scanned root
#   skills/advisor-team/SKILL.md  the role-prompt paths the skill tells the model to read
#
# DSH cannot compute that path for us: `!!js` expressions are rejected inside a
# preset's nested `config` (the installer parses the patch as plain YAML), and a
# relative path does not resolve from a preset row. Hence one explicit,
# verifiable substitution before install.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Every file that may contain the placeholder, relative to this directory.
TARGETS=(
  "cordis.patch.yml"
  "skills/advisor-team/SKILL.md"
)

found=0
for rel in "${TARGETS[@]}"; do
  [ -f "$DIR/$rel" ] && grep -q '__PRESET_DIR__' "$DIR/$rel" && found=1
done

if [ "$found" -eq 0 ]; then
  echo "nothing to do: no __PRESET_DIR__ placeholder found"
  echo "current preset dir is: $DIR"
  exit 0
fi

# Only rewrite the literal placeholder; every other byte is preserved.
python3 - "$DIR" "${TARGETS[@]}" <<'PY'
import sys, pathlib
directory, relatives = sys.argv[1], sys.argv[2:]
total = 0
for rel in relatives:
    path = pathlib.Path(directory) / rel
    if not path.is_file():
        continue
    text = path.read_text(encoding='utf-8')
    count = text.count('__PRESET_DIR__')
    if count == 0:
        continue
    path.write_text(text.replace('__PRESET_DIR__', directory), encoding='utf-8')
    total += count
    print(f'  {rel}: {count} reference(s)')
print(f'set __PRESET_DIR__ -> {directory} ({total} total)')
PY

echo "verify: $(grep -rl "$DIR" "$DIR/cordis.patch.yml" "$DIR/skills" 2>/dev/null | wc -l) file(s) now reference this directory"
echo "remaining placeholders: $(grep -rl '__PRESET_DIR__' "$DIR" 2>/dev/null | wc -l) file(s)"
