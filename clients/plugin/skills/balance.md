Use the Bash tool to run:
  vultisig balance [chain] --silent -o json

- [chain] is optional. If the user specified a chain (e.g. "ethereum", "bitcoin"), include it.
  Omit for all chains.
- Add --vault <name> if the user specified a vault.
- Add --password <pwd> if a password was provided (prefer VAULT_PASSWORD env var).

Parse the JSON output and display balances in a readable table.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
