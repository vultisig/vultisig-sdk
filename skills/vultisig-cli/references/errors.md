# Error Reference Guide

## Exit Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 0 | Success | Operation completed |
| 1 | General error | Unexpected failure |
| 2 | Invalid usage | Bad arguments, missing flags |
| 3 | Configuration error | Invalid config file |
| 4 | Authentication error | Wrong password, expired session |
| 5 | Network error | Connection failed, timeout |
| 6 | Vault error | Vault not found, corrupted |
| 7 | Transaction error | Broadcast failed, insufficient funds |

## Common Errors and Solutions

### Vault Errors

#### "No active vault"
```
Error: No active vault found
```
**Cause**: No vault selected or no vaults exist
**Solution**:
```bash
# List vaults
vultisig vaults

# Create if none exist
vultisig create fast --name "my-wallet" --email "user@example.com" --password "pass"

# Or switch to existing
vultisig switch <vault-id>
```

#### "Vault not found"
```
Error: No vault found with ID: "xyz123"
```
**Cause**: Vault ID doesn't exist
**Solution**:
```bash
vultisig vaults -o json  # List all vaults with IDs
```

#### "Password required"
```
Error: Password is required to unlock this vault
```
**Cause**: Encrypted vault needs password
**Solution**:
```bash
vultisig balance ethereum --password "your-password"
# Or set environment variable
export VAULT_PASSWORD="your-password"
```

#### "Invalid password"
```
Error: Failed to decrypt vault: Invalid password
```
**Cause**: Wrong password provided
**Solution**: Use correct password. If forgotten, restore from backup with known password.

### Transaction Errors

#### "Insufficient balance"
```
Error: Insufficient balance for transaction
```
**Cause**: Not enough funds for amount + gas fees
**Solution**:
```bash
# Check balance
vultisig balance ethereum -o json

# Reduce amount or add funds
```

#### "Broadcast failed"
```
Error: Transaction broadcast failed: nonce too low
```
**Cause**: Transaction already submitted or nonce conflict
**Solution**: Wait for pending transactions to confirm, or check if already succeeded.

#### "Gas estimation failed"
```
Error: Failed to estimate gas
```
**Cause**: Transaction would fail (e.g., insufficient token balance, contract error)
**Solution**: Verify recipient address, token contract, and amounts.

### Network Errors

#### "Connection timeout"
```
Error: Network request timed out
```
**Cause**: Server unreachable or slow network
**Solution**:
```bash
# Check server status
vultisig server

# Retry after a moment
```

#### "Rate limited"
```
Error: Too many requests
```
**Cause**: Too many API calls
**Solution**: Add delays between operations, implement exponential backoff.

### Verification Errors

#### "Invalid verification code"
```
Error: Invalid verification code
```
**Cause**: Wrong code entered or code expired
**Solution**:
```bash
# Request new code
vultisig verify <vault-id> --resend

# Enter new code
vultisig verify <vault-id>
```

### Chain Errors

#### "Chain not enabled"
```
Error: Chain "Solana" is not enabled on this vault
```
**Solution**:
```bash
vultisig chains --add Solana
```

#### "Invalid chain"
```
Error: Invalid chain: "Bitcoinn"
```
**Cause**: Typo in chain name
**Solution**: Check spelling. Use `vultisig chains` to see valid names.

### Swap Errors

#### "No swap route"
```
Error: No swap route available for this pair
```
**Cause**: No liquidity path exists
**Solution**:
```bash
# Check supported pairs
vultisig swap-chains

# Try different amount or pair
```

#### "Slippage exceeded"
```
Error: Slippage tolerance exceeded
```
**Cause**: Price moved during transaction
**Solution**: Increase slippage tolerance or retry.

## Error Handling in Scripts

### Bash Example

```bash
#!/bin/bash
set -e  # Exit on error

# Capture output and exit code
if OUTPUT=$(vultisig send ethereum 0x... 0.1 --password "$VAULT_PASSWORD" -y -o json 2>&1); then
  TX_HASH=$(echo "$OUTPUT" | jq -r '.txHash')
  echo "Success: $TX_HASH"
else
  EXIT_CODE=$?
  echo "Failed with code $EXIT_CODE: $OUTPUT"

  case $EXIT_CODE in
    4) echo "Authentication error - check password" ;;
    5) echo "Network error - retry later" ;;
    7) echo "Transaction error - check balance/address" ;;
    *) echo "Unknown error" ;;
  esac
  exit $EXIT_CODE
fi
```

### Retry Pattern

```bash
#!/bin/bash
MAX_RETRIES=3
RETRY_DELAY=5

for i in $(seq 1 $MAX_RETRIES); do
  if vultisig balance ethereum -o json; then
    break
  fi

  if [ $i -eq $MAX_RETRIES ]; then
    echo "Failed after $MAX_RETRIES attempts"
    exit 1
  fi

  echo "Retry $i/$MAX_RETRIES in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done
```

## Debugging

Enable debug output for more details:

```bash
vultisig balance ethereum --debug
# Or
VULTISIG_DEBUG=1 vultisig balance ethereum
```

## Getting Help

If errors persist:
1. Check [GitHub Issues](https://github.com/vultisig/vultisig-sdk/issues)
2. Verify you're on latest version: `vultisig update --check`
3. Try with `--debug` flag for detailed output
