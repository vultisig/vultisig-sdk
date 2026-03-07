---
description: Show detailed information about a vault including name, type, threshold, public keys, supported chains, and creation date.
---

Use the Bash tool to run:
  vultisig info --silent -o json

- Add --vault <name> to inspect a specific vault (uses default vault if omitted).

Parse the JSON output and display detailed vault information: name, type, threshold, public keys, supported chains, and creation date.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
