Use the Bash tool to run:
  vsig portfolio --silent -o json

- Add --vault <name> if the user specified a vault.
- Add --currency <code> to show fiat values in a specific currency (e.g. USD, EUR).

Parse the JSON output and display a portfolio summary: total value, per-chain breakdown, and individual token holdings.
If vsig is not found, ask the user to install it: npm install -g @vultisig/cli
