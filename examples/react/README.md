# VultiSig SDK - React Integration Example

This example demonstrates how to integrate the VultiSig SDK into a React application.

## Features Demonstrated

- **Fast Vault Creation**: Complete email → password → verification → keygen flow
- **Balance Display**: Real-time vault balance viewing across multiple chains
- **Transaction Signing**: Sign transactions with MPC security
- **Message Signing**: Sign custom messages for authentication
- **Multi-Chain Support**: Ethereum, Bitcoin, Cosmos, THORChain, Solana

## Getting Started

1. Install dependencies:

   ```bash
   yarn install
   ```

2. Configure environment variables (optional):

   ```bash
   # Copy the example file
   cp .env.example .env.local

   # Edit .env.local with your preferred values
   # The .env.local file is gitignored and takes precedence
   ```

3. Start the development server:

   ```bash
   yarn dev
   ```

4. Open http://localhost:3000 in your browser

## Configuration

This example uses environment variables for default form values. The hierarchy is:

1. `.env.local` (gitignored, highest priority)
2. `.env.example` (committed, fallback values)

### Environment Variables

| Variable              | Description           | Default                   |
| --------------------- | --------------------- | ------------------------- |
| `VITE_VAULT_NAME`     | Default vault name    | `TestVault`               |
| `VITE_VAULT_EMAIL`    | Default email address | `cryptoforlyfe@gmail.com` |
| `VITE_VAULT_PASSWORD` | Default password      | `Password123!`            |

**Note**: All environment variables must be prefixed with `VITE_` to be accessible in the browser.

## Usage Flow

1. **Create Vault**: Enter vault name, email, and password
2. **Email Verification**: Check email for verification code
3. **View Balances**: See addresses and balances across supported chains
4. **Sign Transactions**: Test transaction signing functionality
5. **Sign Messages**: Test message signing for authentication

## Code Structure

- `src/App.tsx` - Main application component
- `src/components/VaultCreator.tsx` - Vault creation form
- `src/components/BalanceDisplay.tsx` - Balance and address display
- `src/components/NetworkStatus.tsx` - Network connectivity status

## SDK Integration

```typescript
import { VultisigSDK } from "@vultisig/sdk";

const sdk = new VultisigSDK({
  serverUrl: "https://api.vultisig.com/router",
  theme: "light",
});

// Initialize SDK
await sdk.initialize();

// Create vault
const { vault, vaultId } = await sdk.createFastVault({
  name: "My Vault",
  email: "user@example.com",
  password: "secure_password",
});

// Sign transaction
const signature = await sdk.signTransaction(vault, txData);
```
