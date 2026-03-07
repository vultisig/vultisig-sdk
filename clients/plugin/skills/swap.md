Use the Bash tool to run:
  vultisig swap <from> <to> <amount> -y --silent -o json

- <from>: source asset in "CHAIN.TICKER" format (e.g. "ETH.ETH", "BTC.BTC", "THOR.RUNE")
- <to>: destination asset in "CHAIN.TICKER" format
- <amount>: amount to swap in human-readable units (e.g. "0.1")
- -y: auto-confirm (required for non-interactive use)
- Add --vault <name> if the user specified a vault.
- Add --password <pwd> if a password was provided (prefer VAULT_PASSWORD env var).
- Add --slippage <pct> to set max slippage tolerance (e.g. "1.0" for 1%).

If the user hasn't specified all three required parameters, ask for them.
Always show the swap quote first and confirm with the user before executing.

Parse the JSON output and display the transaction hash and status.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
