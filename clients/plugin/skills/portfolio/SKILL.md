---
description: Show total portfolio value and per-chain token holdings for the active Vultisig vault.
---

Use the Bash tool to run:
  vultisig portfolio --silent -o json

- Add --vault <name> if the user specified a vault.
- Add --currency <code> to show fiat values in a specific currency (e.g. USD, EUR).

Parse the JSON output and display a portfolio summary: total value, per-chain breakdown, and individual token holdings.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
