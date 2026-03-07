Use the Bash tool to run:
  vsig chains --silent -o json

Parse the JSON output and display the list of supported chains in a readable format, grouped by ecosystem (EVM, UTXO, Cosmos, etc.) if grouping information is available.
If vsig is not found, ask the user to install it: npm install -g @vultisig/cli
