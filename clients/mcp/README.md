# @vultisig/mcp

Model Context Protocol server that exposes the Vultisig SDK to LLM tool-calling hosts (Claude Desktop, IDEs, agent frameworks). Runs over stdio as a JSON-RPC 2.0 transport.

## Install

```bash
npm install -g @vultisig/mcp
```

## Usage

```bash
# Set up credentials via the CLI first
vsig auth setup

# Then run the MCP server (stdio)
vmcp --vault <id-or-path>

# Read-only profile (disables send/swap)
vmcp --vault <id-or-path> --profile harness
```

## Tools

| Profile   | Tools                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| `defi` (default) | `get_balances`, `get_portfolio`, `get_address`, `vault_info`, `supported_chains`, `swap_quote`, `send`, `swap` |
| `harness` | `get_balances`, `get_portfolio`, `get_address`, `vault_info`, `supported_chains`, `swap_quote` (read-only)       |

## Confirmation model (important)

**Mutating tools (`send`, `swap`) rely on the MCP host to gate human confirmation.** The server treats a call as a broadcast-for-real only when the host passes `confirmed: true` (strict boolean via Zod — `"true"`, `1`, or truthy strings are rejected). Without `confirmed`, the call is a dry-run preview.

**This means:**

- A well-behaved MCP host (Claude Desktop, Cursor, etc.) **must** show the user the tool-call payload and require explicit confirmation before passing `confirmed: true`.
- A buggy or malicious host can bypass that gate. **Do not run `@vultisig/mcp` against untrusted hosts when the `defi` profile is active.**
- For server-deployed MCP instances, prefer `--profile harness` (read-only) unless you have a second-factor gate out of band.

If you want to add your own confirmation flow (e.g. 2FA, webhook, manual approval service), run the server with `--profile harness` and wire `send`/`swap` through your own tooling.

## Security notes

- Credentials are read from the same keyring (or encrypted file fallback) that the CLI uses — `@napi-rs/keyring` with AES-256-GCM + async scrypt fallback for headless environments.
- stdio framing is kept strict: all SDK log output is redirected to stderr before initialization to prevent JSON-RPC stream corruption.
- Tools do not accept arbitrary user-supplied RPC overrides; use CLI config for endpoint customization.
