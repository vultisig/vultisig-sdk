#!/usr/bin/env bash
# agent-smoke-test.sh — Deterministic read-only smoke test for `vultisig agent ask --json`.
#
# Sends fixed queries to the real agent backend (default https://abe.vultisig.com),
# validates JSON shape with jq. Not an LLM-in-the-loop test.
#
# Prerequisites:
#   - jq(1) on PATH
#   - Node + yarn deps (run from repo root: npx tsx clients/cli/src/index.ts)
#   - Private fixture root: set VAULT_FIXTURE_ROOT, or put the path in .cursor/.vault-fixtures-root
#   - FAST_VAULT_PASSWORD: exported in the environment, or defined in <fixture-root>/.envrc (sourced automatically)
#   - Vault file: <fixture-root>/vaults/fast-vault-share1of2.vult
#
# Usage (from repo root — auto-sources <fixture-root>/.envrc when FAST_VAULT_PASSWORD is unset):
#   bash testdata/agent-smoke-test.sh
#
# Explicit env (optional):
#   VAULT_FIXTURE_ROOT=/path/to/private/fixtures bash testdata/agent-smoke-test.sh
#
# Optional env:
#   AGENT_SMOKE_TIMEOUT — per-command wall timeout in seconds (default 120).
#   AGENT_SMOKE_AI_RETRIES — extra `agent ask` attempts on empty/failed response (default 1).
#
# Exit 0 = all cases passed, 1 = any failure (fail fast).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_ROOT_SOURCE="${VAULT_FIXTURE_ROOT_FILE:-$REPO_ROOT/.cursor/.vault-fixtures-root}"
VAULT_REL="vaults/fast-vault-share1of2.vult"
QUERY_TIMEOUT_SEC="${AGENT_SMOKE_TIMEOUT:-120}"
# Extra attempts when the backend returns exit 0 but an empty assistant message (transient "no response from AI").
AGENT_SMOKE_AI_RETRIES="${AGENT_SMOKE_AI_RETRIES:-1}"

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required on PATH"
  exit 1
fi

if [[ -z "${VAULT_FIXTURE_ROOT:-}" && ! -f "$FIXTURE_ROOT_SOURCE" ]]; then
  echo "FAIL: Set VAULT_FIXTURE_ROOT or create .cursor/.vault-fixtures-root"
  exit 1
fi

FIXTURE_ROOT="${VAULT_FIXTURE_ROOT:-$(tr -d '\r\n' <"$FIXTURE_ROOT_SOURCE")}"
FIXTURE_ENVRC="${FIXTURE_ROOT}/.envrc"

if [[ -z "${FAST_VAULT_PASSWORD:-}" && -f "$FIXTURE_ENVRC" ]]; then
  echo "Note: FAST_VAULT_PASSWORD unset; sourcing fixture env file"
  set -a
  # shellcheck disable=SC1090
  source "$FIXTURE_ENVRC"
  set +a
fi

if [[ -z "${FAST_VAULT_PASSWORD:-}" ]]; then
  echo "FAIL: FAST_VAULT_PASSWORD is unset. Export it or define it in the fixture env file."
  exit 1
fi

VAULT_FILE="$FIXTURE_ROOT/$VAULT_REL"
if [[ ! -f "$VAULT_FILE" ]]; then
  echo "FAIL: Vault file not found at fixture-relative path: $VAULT_REL"
  exit 1
fi

CLI=(npx tsx clients/cli/src/index.ts)

# Run $@ with wall-clock timeout QUERY_TIMEOUT_SEC (portable; no GNU coreutils timeout on macOS).
# Uses a sleeper subshell so the main thread can `wait` the child immediately when it exits
# (avoids polling `kill -0` on zombies, which would spin until the timeout).
with_timeout() {
  local max="$1"
  shift
  "$@" &
  local pid=$!
  (
    sleep "$max"
    if kill -0 "$pid" 2>/dev/null; then
      echo "FAIL: command timed out after ${max}s: $*" >&2
      kill -TERM "$pid" 2>/dev/null || true
      sleep 2
      kill -KILL "$pid" 2>/dev/null || true
    fi
  ) &
  local killer=$!
  wait "$pid"
  local code=$?
  kill "$killer" 2>/dev/null || true
  wait "$killer" 2>/dev/null || true
  if [[ "$code" -eq 143 ]] || [[ "$code" -eq 137 ]]; then
    return 124
  fi
  return "$code"
}

# Same as with_timeout, plus periodic stderr lines so long agent/MPC steps do not look hung.
with_timeout_heartbeat() {
  local max="$1"
  shift
  echo "  → Running (wall timeout ${max}s). Progress: stderr lines from --verbose / MPC below." >&2
  echo "  → Started: $(date '+%H:%M:%S')" >&2
  "$@" &
  local pid=$!
  (
    sleep "$max"
    if kill -0 "$pid" 2>/dev/null; then
      echo "FAIL: command timed out after ${max}s: $*" >&2
      kill -TERM "$pid" 2>/dev/null || true
      sleep 2
      kill -KILL "$pid" 2>/dev/null || true
    fi
  ) &
  local killer=$!
  (
    local elapsed=0
    while kill -0 "$pid" 2>/dev/null; do
      sleep 15
      if kill -0 "$pid" 2>/dev/null; then
        elapsed=$((elapsed + 15))
        echo "  → ${elapsed}s elapsed, still running… ($(date '+%H:%M:%S'))" >&2
      fi
    done
  ) &
  local hb=$!
  wait "$pid"
  local code=$?
  kill "$hb" "$killer" 2>/dev/null || true
  wait "$hb" 2>/dev/null || true
  wait "$killer" 2>/dev/null || true
  echo "  → Finished: $(date '+%H:%M:%S') (exit ${code})" >&2
  if [[ "$code" -eq 143 ]] || [[ "$code" -eq 137 ]]; then
    return 124
  fi
  return "$code"
}

assert_json_ok() {
  local file="$1"
  local label="$2"
  local err
  err="$(jq -r '.error.message? // .error? // .data.error.message? // .data.error? // empty' "$file" 2>/dev/null || true)"
  if [[ -n "$err" ]]; then
    echo "FAIL [$label]: agent error: $err"
    cat "$file" >&2 || true
    exit 1
  fi
}

extract_json_payload() {
  local raw_file="$1"
  local json_file="$2"

  node --input-type=commonjs - "$raw_file" "$json_file" <<'NODE'
const fs = require('node:fs')

const [rawFile, jsonFile] = process.argv.slice(2)
const text = fs.readFileSync(rawFile, 'utf8')

function findJsonEnd(start) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }

  return -1
}

let payload = null
for (let start = 0; start < text.length; start++) {
  if (text[start] !== '{') continue

  const end = findJsonEnd(start)
  if (end < 0) continue

  const candidate = text.slice(start, end)
  try {
    JSON.parse(candidate)
    payload = candidate
  } catch {
    // Ignore log fragments that happen to contain braces.
  }

  start = end - 1
}

if (!payload) process.exit(1)
fs.writeFileSync(jsonFile, `${payload}\n`)
NODE
}

# Run `agent ask --json`; retry on command failure or empty .response (live backend flakes).
run_agent_ask_json() {
  local label="$1"
  local message="$2"
  local out_file="$3"
  local session_id="${4:-}"
  local raw_file="${out_file}.raw"
  local attempt=1
  local max=$((1 + AGENT_SMOKE_AI_RETRIES))
  local -a session_args=()
  [[ -n "$session_id" ]] && session_args=(--session "$session_id")

  while [[ "$attempt" -le "$max" ]]; do
    if [[ "$attempt" -gt 1 ]]; then
      echo "WARN [$label]: retry ${attempt}/${max} (after empty/failed ask)..." >&2
      sleep 5
    fi
    rm -f "$raw_file"
    if with_timeout_heartbeat "$QUERY_TIMEOUT_SEC" "${CLI[@]}" agent ask "$message" --json --verbose --password "$FAST_VAULT_PASSWORD" "${session_args[@]}" >"$raw_file" 2>&1 &&
      extract_json_payload "$raw_file" "$out_file"; then
      rm -f "$raw_file"
      assert_json_ok "$out_file" "$label"
      local resp
      resp="$(jq -r '.response // .data.response // empty' "$out_file" 2>/dev/null || true)"
      if [[ -n "$resp" ]]; then
        return 0
      fi
    fi
    rm -f "$raw_file"
    attempt=$((attempt + 1))
  done
  return 1
}

echo "=== Agent smoke test (repo: $(basename "$REPO_ROOT"), timeout: ${QUERY_TIMEOUT_SEC}s per step, AI retries: ${AGENT_SMOKE_AI_RETRIES}) ==="
echo

# --- 1. Import vault ---
echo "[1/5] Import vault: $VAULT_REL"
if with_timeout "$QUERY_TIMEOUT_SEC" "${CLI[@]}" import "$VAULT_FILE" --password "$FAST_VAULT_PASSWORD"; then
  echo "PASS [1/5] import (exit 0)"
else
  echo "FAIL [1/5] import (non-zero exit or timeout)"
  exit 1
fi
echo

# --- 2. Get balances ---
BAL_JSON="$(mktemp -t agent-smoke-bal.XXXXXX.json)"
trap 'rm -f "$BAL_JSON"' EXIT

echo "[2/5] agent ask: What are my balances?"
echo "    (This step usually takes 30–90s: LLM + tools + optional FastVault MPC signing. Not frozen.)"
if ! run_agent_ask_json "balances" "What are my balances?" "$BAL_JSON"; then
  echo "FAIL [2/5] balances: command failed, timed out, or empty response after retries"
  exit 1
fi

SESSION_ID="$(jq -r '.session_id // .data.session_id // empty' "$BAL_JSON")"
RESPONSE="$(jq -r '.response // .data.response // empty' "$BAL_JSON")"
if [[ -z "$SESSION_ID" ]]; then
  echo "FAIL [2/5] balances: missing session_id"
  exit 1
fi
if [[ -z "$RESPONSE" ]]; then
  echo "FAIL [2/5] balances: empty response"
  exit 1
fi
if jq -e '((.tool_calls // .data.tool_calls // []) | length) > 0' "$BAL_JSON" >/dev/null; then
  if ! jq -e '[((.tool_calls // .data.tool_calls // [])[]?) | select(.success == true)] | length > 0' "$BAL_JSON" >/dev/null; then
    echo "FAIL [2/5] balances: tool_calls were present but none succeeded"
    jq '.tool_calls // .data.tool_calls' "$BAL_JSON" >&2 || true
    exit 1
  fi
  echo "PASS [2/5] balances (session_id=$SESSION_ID, response_chars=${#RESPONSE}, has successful tool_calls)"
else
  echo "PASS [2/5] balances (session_id=$SESSION_ID, response_chars=${#RESPONSE}, no tool calls returned)"
fi
echo

# --- 3. Get portfolio ---
PORT_JSON="$(mktemp -t agent-smoke-port.XXXXXX.json)"
trap 'rm -f "$BAL_JSON" "$PORT_JSON"' EXIT

echo "[3/5] agent ask: What is my portfolio with USD values?"
echo "    (Often 45–120s: many balance/price tool calls before the model answers.)"
if ! run_agent_ask_json "portfolio" "What is my portfolio with USD values?" "$PORT_JSON"; then
  echo "FAIL [3/5] portfolio: command failed, timed out, or empty response after retries"
  exit 1
fi
P_RESP="$(jq -r '.response // .data.response // empty' "$PORT_JSON")"
# Dollar, USD label, or plausible fiat formatting (e.g. $1,234.56 or 1234.56 USD)
if ! echo "$P_RESP" | grep -qE '\$|USD|US\$|[0-9]+[.,][0-9]{2}'; then
  echo "WARN [3/5] portfolio: reply had no fiat/USD cues (partial or backend flake). Retrying once in 5s…" >&2
  sleep 5
  if ! run_agent_ask_json "portfolio-retry" "Summarize my portfolio with total value in USD." "$PORT_JSON"; then
    echo "FAIL [3/5] portfolio: retry ask failed or empty"
    exit 1
  fi
  P_RESP="$(jq -r '.response // .data.response // empty' "$PORT_JSON")"
fi
if ! echo "$P_RESP" | grep -qE '\$|USD|US\$|[0-9]+[.,][0-9]{2}'; then
  echo "FAIL [3/5] portfolio: response has no \$ / USD / decimal fiat cues after retry"
  echo "Response preview: ${P_RESP:0:400}"
  exit 1
fi
echo "PASS [3/5] portfolio (response_chars=${#P_RESP}, fiat/USD cues present)"
echo

# --- 4. List vaults ---
LIST_JSON="$(mktemp -t agent-smoke-list.XXXXXX.json)"
trap 'rm -f "$BAL_JSON" "$PORT_JSON" "$LIST_JSON"' EXIT

echo "[4/5] agent ask: List my vaults"
if ! run_agent_ask_json "list vaults" "List my vaults" "$LIST_JSON"; then
  echo "FAIL [4/5] list vaults: command failed, timed out, or empty response after retries"
  exit 1
fi
L_RESP="$(jq -r '.response // .data.response // empty' "$LIST_JSON")"
if ! echo "$L_RESP" | grep -qiE 'vault|vultisig|address|share|wallet'; then
  echo "FAIL [4/5] list vaults: response does not mention vault-like info"
  echo "Response preview: ${L_RESP:0:400}"
  exit 1
fi
echo "PASS [4/5] list vaults (response_chars=${#L_RESP})"
echo

# --- 5. Session continuity ---
FOLLOW_JSON="$(mktemp -t agent-smoke-follow.XXXXXX.json)"
trap 'rm -f "$BAL_JSON" "$PORT_JSON" "$LIST_JSON" "$FOLLOW_JSON"' EXIT

echo "[5/5] agent ask (same session): Which chain has the highest balance?"
if ! run_agent_ask_json "session follow-up" "Which chain has the highest balance?" "$FOLLOW_JSON" "$SESSION_ID"; then
  echo "FAIL [5/5] session follow-up: command failed, timed out, or empty response after retries"
  exit 1
fi
F_SID="$(jq -r '.session_id // .data.session_id // empty' "$FOLLOW_JSON")"
F_RESP="$(jq -r '.response // .data.response // empty' "$FOLLOW_JSON")"
if [[ "$F_SID" != "$SESSION_ID" ]]; then
  echo "FAIL [5/5] session follow-up: session_id mismatch (expected $SESSION_ID, got $F_SID)"
  exit 1
fi
echo "PASS [5/5] session continuity (session_id unchanged, response_chars=${#F_RESP})"
echo

echo "=== All agent smoke tests PASSED ==="
