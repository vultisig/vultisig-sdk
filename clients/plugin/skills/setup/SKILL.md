---
description: Install the Vultisig CLI and guide the user through creating or importing their first vault.
---

# Setup vultisig Skill

Steps:
1. Check if vultisig is already installed: `vultisig --version`
   - If installed, show the version and confirm it's ready.
2. If not installed, run: `npm install -g @vultisig/cli`
   - Verify after: `vultisig --version`
3. Create a vault (if none exists):
   - Ask the user for their vault name and email before running any commands.
   - Fast vault (server-assisted, easiest):
     `vultisig create fast --name "<vault-name>" --email "<email>"`
     The CLI will prompt for a password securely — do not pass it on the command line.
   - Secure vault (multi-device MPC):
     `vultisig create secure --name "<vault-name>" --shares 3`
4. Confirm setup: `vultisig vaults --silent -o json`

Walk the user through each step interactively.
If they have an existing vault file (.vult), offer to import it: `vultisig import /path/to/vault.vult`
