Use the Bash tool to run:
  vultisig swap-quote <from> <to> <amount> --silent -o json

- <from>: source asset in "CHAIN.TICKER" format (e.g. "ETH.ETH", "BTC.BTC", "THOR.RUNE")
- <to>: destination asset in "CHAIN.TICKER" format
- <amount>: amount to swap in human-readable units (e.g. "0.1")
- Add --vault <name> if the user specified a vault.

If the user hasn't specified all three required parameters, ask for them.

Parse the JSON output and display the swap quote: expected output, fees, slippage, and estimated time.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
