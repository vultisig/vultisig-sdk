# E2E Test Security Guide

## Table of Contents

1. [Overview](#overview)
2. [Security Model](#security-model)
3. [Setup Instructions](#setup-instructions)
4. [Security Best Practices](#security-best-practices)
5. [What If Credentials Are Compromised](#what-if-credentials-are-compromised)
6. [FAQ](#faq)

---

## Overview

The E2E test suite performs **real blockchain operations** against live networks (mainnet APIs). To ensure security while testing transaction preparation and signing, we follow a strict security model:

**Core Principles:**

1. **Vault files and passwords MUST NEVER be committed to git**
2. **Test vaults should only contain minimal amounts** ($5-10 per chain max)
3. **Use dedicated test vaults only** (never production vaults)
4. **Most tests are read-only** (no funding required)
5. **Transaction signing tests do NOT broadcast** (funds remain safe)

---

## Security Model

### What's Public (Safe to Share)

✅ **Blockchain addresses** - These are derived from vault public keys and are always public on the blockchain anyway. Knowing an address doesn't compromise security.

Example:
```typescript
{
  Bitcoin: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
  Ethereum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
  // ... more addresses
}
```

### What's Private (NEVER Share or Commit)

❌ **Vault files (.vult)** - Contains encrypted private key shares. If leaked with password, funds can be stolen.

❌ **Vault passwords** - Used to decrypt vault files. If leaked with vault file, funds can be stolen.

❌ **Private keys** - Never exposed directly, but derivable from vault + password.

### Why We Can't Commit Vault Files

Even though vault files are encrypted, **anyone with the vault file + password can:**

- Derive all private keys for all supported chains
- Sign transactions from any of the vault's addresses
- Transfer any funds stored at those addresses
- Compromise any crypto sent to those addresses

**If a vault file is in git history:**
- It's permanently public (even if deleted later)
- Anyone who clones the repo has access
- Attackers can monitor addresses for incoming funds
- Any funds sent to those addresses are at risk

---

## Setup Instructions

### Phase 1: Read-Only Tests (No Funding Required)

Most E2E tests are **read-only** and work with zero balance:
- Balance fetching
- Gas estimation
- Address derivation
- Multi-chain operations
- Caching tests

**Setup Steps:**

1. **Create your local .env file:**
   ```bash
   cd packages/sdk/tests/e2e
   cp .env.example .env
   ```

2. **Option A: Use the reference test vault (read-only tests only)**

   ⚠️ **WARNING: NEVER fund these addresses - vault keys are public!**

   ```bash
   # In packages/sdk/tests/e2e/.env
   TEST_VAULT_PATH=../fixtures/vaults/TestFastVault-44fd-share2of2-Password123!.vult
   TEST_VAULT_PASSWORD=Password123!
   ENABLE_TX_SIGNING_TESTS=false
   ```

   These vault files are **intentionally public** for convenience in read-only tests. However:
   - ❌ DO NOT fund these addresses
   - ❌ DO NOT use for transaction signing tests
   - ✅ Only use for balance/gas estimation tests

3. **Option B: Create your own test vault (recommended)**

   ```bash
   # Create a new vault using Vultisig CLI or SDK
   # Store it outside of the git repository
   # Example location: ~/.vultisig/test-vaults/
   ```

   ```bash
   # In packages/sdk/tests/e2e/.env
   TEST_VAULT_PATH=/Users/yourname/.vultisig/test-vaults/my-e2e-test.vult
   TEST_VAULT_PASSWORD=your-secure-password-here
   ENABLE_TX_SIGNING_TESTS=false
   ```

4. **Run read-only tests:**
   ```bash
   yarn test:e2e
   ```

### Phase 2: Transaction Signing Tests (Requires Funding)

⚠️ **WARNING: Only proceed if you understand the security risks**

**Prerequisites:**
- Created your own test vault (Option B above)
- Vault file stored outside of git
- Strong password set
- Read this entire security guide

**Setup Steps:**

1. **Fund your test vault addresses (minimal amounts only):**

   Recommended funding per chain:
   - Ethereum: $20 (gas is expensive)
   - Bitcoin: $10
   - Solana: $5
   - Other EVM chains: $5-10 each
   - Cosmos chains: $5 each

   **Total recommended maximum: $100 across all chains**

2. **Enable transaction signing tests:**
   ```bash
   # In packages/sdk/tests/e2e/.env
   ENABLE_TX_SIGNING_TESTS=true
   ```

3. **Set up safety limits:**
   ```bash
   # In packages/sdk/tests/e2e/.env
   MAX_TEST_VAULT_BALANCE_USD=100
   ```

   This will warn you if the vault has more funds than expected (suggests using wrong vault).

4. **Run transaction tests:**
   ```bash
   yarn test:e2e:tx-prep
   ```

**Safety Guarantees:**

✅ Tests **NEVER** broadcast transactions to the blockchain
✅ Tests only verify transaction **preparation** and **signing**
✅ Funds remain in wallet after tests complete
✅ Tests verify payloads are correctly formatted but don't submit them

---

## Security Best Practices

### 1. Vault File Storage

✅ **DO:**
- Store vault files outside of the git repository
- Use absolute paths or paths relative to home directory
- Keep vault files in a secure, backed-up location
- Use file permissions to restrict access (`chmod 600`)

❌ **DON'T:**
- Never store vault files inside the git repository
- Never commit vault files to git (check with `git status`)
- Never share vault files via email, Slack, or public channels

### 2. Password Management

✅ **DO:**
- Use strong, unique passwords for test vaults
- Store passwords in `.env` files (which are git-ignored)
- Use a password manager for secure storage
- Rotate passwords periodically

❌ **DON'T:**
- Never hardcode passwords in source code
- Never commit passwords to git
- Never reuse production vault passwords for testing
- Never share passwords publicly

### 3. Funding Limits

✅ **DO:**
- Keep test vault balances minimal ($100 max total)
- Fund only the chains you need to test
- Monitor balances regularly
- Withdraw excess funds immediately

❌ **DON'T:**
- Never fund test vaults with large amounts
- Never use production vaults for testing
- Never send funds to public example addresses
- Never ignore unexpected balance changes

### 4. Git Hygiene

✅ **DO:**
- Always run `git status` before committing
- Review diffs carefully for sensitive data
- Use `.gitignore` patterns for vault files
- Run tests locally before pushing

❌ **DON'T:**
- Never commit `.env` files
- Never commit `.vult` files
- Never push without reviewing changes
- Never ignore git-ignored file warnings

### 5. Development Workflow

✅ **DO:**
- Create separate test vaults for each developer
- Use CI/CD environment variables for automated tests
- Document your test vault setup (without sharing credentials)
- Regularly audit for accidentally committed secrets

❌ **DON'T:**
- Never share vault files between team members
- Never run tests with production vaults
- Never disable security checks
- Never ignore security warnings

---

## What If Credentials Are Compromised

### If Vault File is Committed to Git

**Immediate Actions:**

1. **Assume funds are compromised** - Anyone with the git history can access them
2. **Stop funding** - Don't send any more funds to those addresses
3. **Transfer funds** - Move any existing funds to a new, secure vault immediately
4. **Notify team** - Alert other developers about the compromise
5. **Rotate vault** - Create new test vault with new credentials

**Git Cleanup (Optional but Recommended):**

⚠️ **WARNING: Requires force push - coordinate with team first**

```bash
# Option 1: BFG Repo-Cleaner (easiest)
brew install bfg  # macOS
bfg --delete-files '*.vult' .
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force

# Option 2: git filter-branch
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch "**/*.vult"' \
  --prune-empty --tag-name-filter cat -- --all
git push --force
```

**Note:** Removing files from git history doesn't guarantee they're gone - anyone who previously cloned the repo still has the compromised vault. **The only safe solution is to rotate the vault.**

### If Password is Exposed

**Immediate Actions:**

1. **Change password** - If vault file is still secure, you can re-encrypt
2. **Check vault file** - Ensure it wasn't also compromised
3. **Audit recent activity** - Check blockchain explorers for unexpected transactions
4. **Transfer funds** - If vault file is also compromised, move funds immediately

### If Both are Compromised

**Immediate Actions:**

1. **Emergency fund transfer** - Move all funds to new secure vault NOW
2. **Create new vault** - Generate completely new vault and credentials
3. **Update documentation** - Document new test vault addresses (not credentials)
4. **Post-mortem** - Document what happened and how to prevent it

---

## FAQ

### Q: Why are some vault files checked into git?

**A:** Historical legacy. **These vaults are intentionally public** and should NEVER be funded. They exist for convenience in read-only tests only. We strongly recommend creating your own vault for serious testing.

### Q: Can I use the public test vaults for transaction signing?

**A:** ❌ **NO.** Anyone with git access has those vault files and passwords. Any funds sent to those addresses can be stolen by anyone.

### Q: Do transaction signing tests actually send transactions?

**A:** ❌ **NO.** Tests only prepare and sign transactions locally. They verify the payload format but never broadcast to the blockchain. Your funds stay in the vault.

### Q: What if I accidentally committed my vault file?

**A:** See [What If Credentials Are Compromised](#what-if-credentials-are-compromised). Assume funds are compromised and transfer them immediately.

### Q: Can I run tests in CI/CD?

**A:** ✅ **YES.** For read-only tests (default), use the public test vaults. For transaction tests, store vault credentials in CI/CD secrets (never in code).

### Q: Why do we test against mainnet APIs?

**A:** Testnet APIs are often unreliable or missing for some chains. Mainnet APIs give accurate gas estimates and realistic conditions. We avoid broadcasting to keep funds safe.

### Q: How do I check if my vault is in git?

**A:** Run `git check-ignore -v path/to/your-vault.vult`. If it shows no output, it's NOT ignored and might be committed.

### Q: What's the difference between the public test vault and my own?

**A:**
- **Public test vault**: Credentials in git, safe for read-only tests only, NEVER fund
- **Your vault**: Credentials private, can be funded minimally, suitable for all tests

### Q: Can I share my test vault with teammates?

**A:** ❌ **NO.** Each developer should create their own test vault. Sharing credentials defeats the security model.

---

## Additional Resources

- [E2E Test README](./README.md) - How to run tests
- [CONTINUE_E2E_TESTS.md](../../../../docs/testing/CONTINUE_E2E_TESTS.md) - Development history
- [Main SDK README](../../README.md) - SDK documentation
- [Vultisig Documentation](https://docs.vultisig.com) - General Vultisig docs

---

## Questions or Issues?

If you find a security vulnerability or have questions:

1. **Security issues**: Contact the team privately (do not file public issues)
2. **Setup questions**: File an issue on GitHub
3. **Improvements**: Submit a PR with proposed security enhancements

**Remember: When in doubt about security, ask first!**
