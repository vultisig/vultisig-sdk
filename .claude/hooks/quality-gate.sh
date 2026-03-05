#!/bin/bash
# TaskCompleted hook: verify lint + typecheck pass before task completion
# Exit 2 to block, exit 0 to allow

cd "$CLAUDE_PROJECT_DIR" || exit 0

MODIFIED=$(git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null | grep -E '\.(ts|tsx)$' || true)

if [ -z "$MODIFIED" ]; then
  exit 0
fi

if ! yarn lint 2>/dev/null; then
  echo "Quality gate: ESLint violations found" >&2
  exit 2
fi

if ! yarn typecheck 2>/dev/null; then
  echo "Quality gate: TypeScript errors found" >&2
  exit 2
fi

exit 0
