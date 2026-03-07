Help the user install the Vultisig CLI locally.

Steps:
1. Check if vultisig is already installed: `vultisig --version`
   - If installed, show the version and confirm it's ready.
2. If not installed, run: `npm install -g @vultisig/cli`
   - Or with yarn: `yarn global add @vultisig/cli`
   - Verify after: `vultisig --version`
3. Create a vault (if none exists):
   - Fast vault (server-assisted, easiest):
     `vultisig create fast --name "My Wallet" --email user@example.com --password mypassword`
   - Secure vault (multi-device MPC):
     `vultisig create secure --name "My Wallet" --shares 3`
4. Confirm setup: `vultisig vaults --silent -o json`

Walk the user through each step interactively.
If they have an existing vault file (.vult), offer to import it: `vultisig import /path/to/vault.vult`
