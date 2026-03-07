Use the Bash tool to run:
  vultisig send <chain> <to> <amount> --silent -o json

- <chain>: the chain to send on (e.g. "ethereum", "bitcoin", "thorchain")
- <to>: recipient address
- <amount>: amount in human-readable units (e.g. "0.01")
- Add --token <ticker> to send a token other than the native asset (e.g. --token USDC).
- Add --vault <name> if the user specified a vault.
- If the vault is password-protected, ensure VAULT_PASSWORD is set in the environment. Never pass the password as a CLI argument.

If the user hasn't specified all three required parameters, ask for them.
Always confirm the recipient address and amount with the user before executing.

Parse the JSON output and display the transaction hash and a link to the block explorer.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
