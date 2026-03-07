---
description: Sign arbitrary hex-encoded bytes with the vault key for a given chain using MPC signing.
---

Use the Bash tool to run:
  vultisig sign --chain <chain> --bytes <hex> --silent -o json

- --chain <chain>: the chain whose key to sign with (e.g. "ethereum", "bitcoin")
- --bytes <hex>: hex-encoded bytes to sign (e.g. "0xdeadbeef")
- Add --vault <name> if the user specified a vault.
- If the vault is password-protected, ensure VAULT_PASSWORD is set in the environment. Never pass the password as a CLI argument.

If the user hasn't specified the chain and bytes, ask for them.
Warn the user that signing arbitrary bytes is a low-level operation — confirm they know what they are signing.

Parse the JSON output and display the resulting signature.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
