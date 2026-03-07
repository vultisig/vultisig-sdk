---
description: List supported tokens for a specific chain, including symbols, contract addresses, and decimals.
---

Use the Bash tool to run:
  vultisig tokens <chain> --silent -o json

- <chain> is required. Ask the user which chain if not specified (e.g. "ethereum", "thorchain").
- Add --vault <name> if the user specified a vault.

Parse the JSON output and display the token list with symbols, contract addresses, and decimals.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
