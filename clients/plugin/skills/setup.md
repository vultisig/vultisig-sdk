Help the user install the Vultisig CLI locally.

Steps:
1. Check if vsig is already installed: `vsig --version`
   - If installed, show the version and confirm it's ready.
2. If not installed, run: `npm install -g @vultisig/cli`
   - Or with yarn: `yarn global add @vultisig/cli`
   - Verify after: `vsig --version`
3. Create a vault (if none exists):
   - Fast vault (server-assisted, easiest):
     `vsig create fast --name "My Wallet" --email user@example.com --password mypassword`
   - Secure vault (multi-device MPC):
     `vsig create secure --name "My Wallet" --shares 3`
4. Confirm setup: `vsig vaults --silent -o json`

Walk the user through each step interactively.
If they have an existing vault file (.vult), offer to import it: `vsig import /path/to/vault.vult`
