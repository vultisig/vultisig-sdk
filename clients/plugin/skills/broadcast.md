Use the Bash tool to run:
  vultisig broadcast --chain <chain> --raw-tx <tx> --silent -o json

- --chain <chain>: the chain to broadcast on (e.g. "ethereum", "bitcoin")
- --raw-tx <tx>: hex-encoded signed transaction bytes

If the user hasn't specified the chain and raw transaction, ask for them.
Confirm the chain and transaction with the user before broadcasting — this action cannot be undone.

Parse the JSON output and display the transaction hash and a link to the block explorer.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
