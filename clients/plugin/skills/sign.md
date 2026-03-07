Use the Bash tool to run:
  vultisig sign --chain <chain> --bytes <hex> --silent -o json

- --chain <chain>: the chain whose key to sign with (e.g. "ethereum", "bitcoin")
- --bytes <hex>: hex-encoded bytes to sign (e.g. "0xdeadbeef")
- Add --vault <name> if the user specified a vault.
- Add --password <pwd> if a password was provided (prefer VAULT_PASSWORD env var).

If the user hasn't specified the chain and bytes, ask for them.
Warn the user that signing arbitrary bytes is a low-level operation — confirm they know what they are signing.

Parse the JSON output and display the resulting signature.
If vultisig is not found, ask the user to install it: npm install -g @vultisig/cli
