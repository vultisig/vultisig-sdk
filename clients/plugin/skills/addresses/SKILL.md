---
description: List wallet addresses for all chains or a specific chain from the active Vultisig vault.
---
Use the Bash tool to run:
  vultisig addresses --silent -o json

- Add --vault <name> if the user specified a vault.
- Add --chain <chain> to filter to a specific chain.

Parse the JSON output and display each chain with its address in a readable table.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
