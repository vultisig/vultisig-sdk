#!/usr/bin/env bash
# verify-result.sh — Repo-owned integration test verifier.
# Validates the JSON output from `vultisig agent ask --json`.
#
# Usage: verify-result.sh <result.json> [--require-tx]
#
# Exit 0 = PASS, exit 1 = FAIL
set -euo pipefail

RESULT_FILE="${1:?Usage: verify-result.sh <result.json> [--require-tx]}"
REQUIRE_TX="${2:-}"

if [ ! -f "$RESULT_FILE" ]; then
  echo "::error::Result file not found: $RESULT_FILE"
  exit 1
fi

echo "=== Agent Result ==="
cat "$RESULT_FILE"
echo ""

# Check for top-level error
ERROR=$(jq -r '.error // empty' "$RESULT_FILE" 2>/dev/null)
if [ -n "$ERROR" ]; then
  echo "::error::Agent returned error: $ERROR"
  exit 1
fi

# Verify session_id exists (proves the backend round-trip worked)
SESSION_ID=$(jq -r '.session_id // empty' "$RESULT_FILE" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then
  echo "::error::No session_id in response — backend communication failed"
  exit 1
fi
echo "Session: $SESSION_ID"

# Verify we got a response
RESPONSE=$(jq -r '.response // empty' "$RESULT_FILE" 2>/dev/null)
if [ -z "$RESPONSE" ]; then
  echo "::error::Empty response from agent"
  exit 1
fi
echo "Response length: ${#RESPONSE} chars"

# Check tool_calls for errors
TOOL_ERRORS=$(jq -r '[.tool_calls[]? | select(.success == false) | .error // .action] | join(", ")' "$RESULT_FILE" 2>/dev/null)
if [ -n "$TOOL_ERRORS" ]; then
  echo "::warning::Tool call errors: $TOOL_ERRORS"
fi

# Report tool calls
TOOLS=$(jq -r '[.tool_calls[]?.action] | join(" → ")' "$RESULT_FILE" 2>/dev/null)
echo "Tools: ${TOOLS:-none}"

# Report transactions
TX_COUNT=$(jq -r '[.transactions[]?] | length' "$RESULT_FILE" 2>/dev/null)
TX_HASHES=$(jq -r '[.transactions[]?.hash] | join(", ")' "$RESULT_FILE" 2>/dev/null)
echo "Transactions: ${TX_COUNT:-0} (${TX_HASHES:-none})"

# If --require-tx, assert at least one transaction
if [ "$REQUIRE_TX" = "--require-tx" ]; then
  if [ "${TX_COUNT:-0}" -lt 1 ]; then
    echo "::error::Expected at least one transaction but got none"
    exit 1
  fi
fi

echo "Integration test PASSED"
