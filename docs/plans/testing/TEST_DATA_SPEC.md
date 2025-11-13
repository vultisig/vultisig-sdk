# Test Data Specification: Chain Fixtures for 30+ Blockchains

## Overview

This document provides comprehensive specifications for test fixtures required for each of the 30+ blockchains supported by the Vultisig SDK. Each blockchain MUST have complete test fixtures to ensure proper testing coverage.

## Directory Structure

```
tests/fixtures/
├── chains/                     # Chain-specific fixtures
│   ├── bitcoin/
│   ├── ethereum/
│   ├── solana/
│   ├── thorchain/
│   ├── ripple/
│   ├── cosmos/
│   ├── polygon/
│   ├── binance-smart-chain/
│   ├── avalanche/
│   ├── arbitrum/
│   ├── optimism/
│   ├── base/
│   ├── blast/
│   ├── zksync/
│   ├── litecoin/
│   ├── dogecoin/
│   ├── bitcoin-cash/
│   ├── dash/
│   ├── osmosis/
│   ├── kujira/
│   ├── dydx/
│   ├── noble/
│   ├── tron/
│   ├── sui/
│   ├── polkadot/
│   ├── near/
│   └── ton/
├── vaults/                      # Vault fixtures
├── server/                      # Server response fixtures
└── common/                      # Shared test data
```

## Chain Fixture Specifications

Each chain directory MUST contain the following files with exact specifications:

### 1. addresses.json
Contains valid and invalid addresses for testing address validation and derivation.

### 2. transactions.json
Contains unsigned and signed transaction examples for testing transaction building and signing.

### 3. balances.json
Contains balance query responses for testing balance fetching and formatting.

### 4. rpc-responses.json
Contains mock RPC responses for testing blockchain interactions.

### 5. derivation.json
Contains HD wallet derivation paths and expected keys.

## Detailed Chain Specifications

### Bitcoin (BTC) - UTXO Model
**Chain ID**: bitcoin
**Type**: UTXO
**Signature**: ECDSA

```json
// bitcoin/addresses.json
{
  "valid": [
    {
      "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      "publicKey": "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
      "derivationPath": "m/84'/0'/0'/0/0",
      "type": "p2wpkh",
      "network": "mainnet"
    },
    {
      "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
      "publicKey": "0479BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8",
      "derivationPath": "m/44'/0'/0'/0/0",
      "type": "p2pkh",
      "network": "mainnet"
    },
    {
      "address": "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      "publicKey": "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
      "derivationPath": "m/49'/0'/0'/0/0",
      "type": "p2sh-p2wpkh",
      "network": "mainnet"
    },
    {
      "address": "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      "publicKey": "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
      "derivationPath": "m/84'/1'/0'/0/0",
      "type": "p2wpkh",
      "network": "testnet"
    }
  ],
  "invalid": [
    "invalid_btc_address",
    "bc1qinvalid",
    "3InvalidP2SH",
    "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wl", // Too short
    "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlhh", // Too long
    "BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH", // Wrong case
    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa1", // Extra character
    ""
  ]
}

// bitcoin/transactions.json
{
  "unsigned": {
    "simple": {
      "inputs": [
        {
          "txid": "7b6a7de8c1e4b5d9f3a2c8e4b7d9a3f5c8e2b4a6d9f3c7e1a4b8d2c5e9f1a3b7",
          "vout": 0,
          "value": "100000000",
          "scriptPubKey": "0014abcdef1234567890abcdef1234567890abcdef12"
        }
      ],
      "outputs": [
        {
          "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
          "value": "50000000"
        },
        {
          "address": "bc1q9qs5x8xwqykhxzpv6vqyhy8hu2p5p5lskfaapt",
          "value": "49990000"
        }
      ],
      "fee": "10000",
      "version": 2,
      "locktime": 0
    },
    "complex": {
      "inputs": [
        {
          "txid": "input1_txid",
          "vout": 0,
          "value": "50000000"
        },
        {
          "txid": "input2_txid",
          "vout": 1,
          "value": "75000000"
        }
      ],
      "outputs": [
        {
          "address": "bc1qaddr1",
          "value": "100000000"
        },
        {
          "address": "bc1qaddr2",
          "value": "24990000"
        }
      ]
    }
  },
  "signed": {
    "simple": {
      "hex": "02000000000101b7a3f1e9c5d2b8a4e1c7f3d9a6b4e2c8f5a3d9b7e4c8a2f3d9b5e4c1e8d7a67b0000000000ffffffff0280f0fa02000000001600143120a96c118f519089406fcfbd9f1a1706e3d0e770f30c01000000001600142820431cc7007256b108c6b004b90e7e5054195402473044022001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef022001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef01210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f8179800000000",
      "txid": "a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890",
      "signatures": [
        {
          "inputIndex": 0,
          "signature": "3044022001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef022001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef01"
        }
      ]
    }
  },
  "messageHashes": {
    "simple": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    "complex": "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321"
  }
}

// bitcoin/balances.json
{
  "native": {
    "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    "balance": "123456789",
    "decimals": 8,
    "formatted": "1.23456789",
    "usdValue": 61728.39,
    "confirmations": 6,
    "utxos": [
      {
        "txid": "utxo1_txid",
        "vout": 0,
        "value": "50000000",
        "confirmations": 10
      },
      {
        "txid": "utxo2_txid",
        "vout": 1,
        "value": "73456789",
        "confirmations": 3
      }
    ]
  }
}

// bitcoin/rpc-responses.json
{
  "getBalance": {
    "result": "1.23456789",
    "error": null,
    "id": 1
  },
  "listUnspent": {
    "result": [
      {
        "txid": "txid1",
        "vout": 0,
        "address": "bc1qaddr",
        "amount": 0.5,
        "confirmations": 10,
        "scriptPubKey": "0014..."
      }
    ]
  },
  "estimateSmartFee": {
    "result": {
      "feerate": 0.00001,
      "blocks": 2
    }
  },
  "sendRawTransaction": {
    "result": "txid_hash",
    "error": null
  }
}
```

### Ethereum (ETH) - EVM Chain
**Chain ID**: ethereum
**Type**: Account-based
**Signature**: ECDSA

```json
// ethereum/addresses.json
{
  "valid": [
    {
      "address": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
      "publicKey": "0x04e68acfc0253a10620dff706b0a1b1f1f5833ea3beb3bde2250d5f271f3563606672ebc45e0b7ea2e816ecb70ca03137b1c9476eec63d4632e990020b7b6fba39",
      "derivationPath": "m/44'/60'/0'/0/0",
      "checksummed": true
    },
    {
      "address": "0x71c7656ec7ab88b098defb751b7401b5f6d8976f",
      "publicKey": "0x04e68acfc0253a10620dff706b0a1b1f1f5833ea3beb3bde2250d5f271f3563606672ebc45e0b7ea2e816ecb70ca03137b1c9476eec63d4632e990020b7b6fba39",
      "derivationPath": "m/44'/60'/0'/0/0",
      "checksummed": false
    }
  ],
  "invalid": [
    "0xinvalid",
    "not_an_address",
    "0x71C7656EC7ab88b098defB751B7401B5f6d8976", // Too short
    "0x71C7656EC7ab88b098defB751B7401B5f6d8976FF", // Too long
    "0x71C7656EC7ab88b098defB751B7401B5f6d8976G", // Invalid character
    "71C7656EC7ab88b098defB751B7401B5f6d8976F", // Missing 0x
    ""
  ]
}

// ethereum/transactions.json
{
  "unsigned": {
    "legacy": {
      "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      "value": "1000000000000000000",
      "gasLimit": "21000",
      "gasPrice": "20000000000",
      "nonce": 0,
      "chainId": 1,
      "data": "0x"
    },
    "eip1559": {
      "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      "value": "1000000000000000000",
      "gasLimit": "21000",
      "maxFeePerGas": "30000000000",
      "maxPriorityFeePerGas": "2000000000",
      "nonce": 0,
      "chainId": 1,
      "type": 2,
      "data": "0x"
    },
    "erc20Transfer": {
      "to": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
      "value": "0",
      "gasLimit": "100000",
      "maxFeePerGas": "30000000000",
      "maxPriorityFeePerGas": "2000000000",
      "nonce": 1,
      "chainId": 1,
      "type": 2,
      "data": "0xa9059cbb000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f0beb00000000000000000000000000000000000000000000000000000000000000064"
    }
  },
  "signed": {
    "eip1559": {
      "hash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "r": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "s": "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
      "v": 0,
      "serialized": "0x02f8710180843b9aca00850430e2340082520894742d35cc6634c0532925a3b844bc9e7595f0beb0880de0b6b3a764000080c001a01234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefa0fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321"
    }
  },
  "messageHashes": {
    "legacy": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "eip1559": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    "erc20Transfer": "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321"
  }
}

// ethereum/balances.json
{
  "native": {
    "address": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    "balance": "1234567890000000000",
    "decimals": 18,
    "formatted": "1.23456789",
    "usdValue": 3703.70,
    "nonce": 5
  },
  "tokens": [
    {
      "contract": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "symbol": "USDC",
      "name": "USD Coin",
      "decimals": 6,
      "balance": "1000000000",
      "formatted": "1000.0",
      "usdValue": 1000.0
    },
    {
      "contract": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "symbol": "USDT",
      "name": "Tether USD",
      "decimals": 6,
      "balance": "500000000",
      "formatted": "500.0",
      "usdValue": 500.0
    }
  ]
}

// ethereum/rpc-responses.json
{
  "eth_getBalance": {
    "jsonrpc": "2.0",
    "id": 1,
    "result": "0x1117e6c3e9dc3c00"
  },
  "eth_getTransactionCount": {
    "jsonrpc": "2.0",
    "id": 1,
    "result": "0x5"
  },
  "eth_gasPrice": {
    "jsonrpc": "2.0",
    "id": 1,
    "result": "0x4a817c800"
  },
  "eth_estimateGas": {
    "jsonrpc": "2.0",
    "id": 1,
    "result": "0x5208"
  },
  "eth_sendRawTransaction": {
    "jsonrpc": "2.0",
    "id": 1,
    "result": "0xtxhash"
  }
}
```

### Solana (SOL) - High Performance Chain
**Chain ID**: solana
**Type**: Account-based
**Signature**: EdDSA

```json
// solana/addresses.json
{
  "valid": [
    {
      "address": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      "publicKey": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      "derivationPath": "m/44'/501'/0'/0'",
      "network": "mainnet-beta"
    },
    {
      "address": "11111111111111111111111111111111",
      "publicKey": "11111111111111111111111111111111",
      "derivationPath": "system",
      "network": "mainnet-beta"
    }
  ],
  "invalid": [
    "invalid_sol_address",
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB26", // Too short
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB2633", // Too long
    "0ezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // Invalid character
    "dezxaz8z7pnrnrjjz3wxborgixca6xjnb7yab1ppb263", // Wrong case
    ""
  ]
}

// solana/transactions.json
{
  "unsigned": {
    "transfer": {
      "from": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      "to": "5oNDL3an3M43RnPVUCPYzvq3zPZ5fv5VsAGdRouYrJYD",
      "amount": "1000000000",
      "recentBlockhash": "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
      "instructions": [
        {
          "programId": "11111111111111111111111111111111",
          "keys": [
            { "pubkey": "from_address", "isSigner": true, "isWritable": true },
            { "pubkey": "to_address", "isSigner": false, "isWritable": true }
          ],
          "data": "transfer_instruction_data"
        }
      ]
    },
    "splTransfer": {
      "from": "owner_address",
      "to": "recipient_address",
      "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      "amount": "1000000",
      "decimals": 6
    }
  },
  "signed": {
    "transfer": {
      "signature": "5VERn6FB9GNFP1VHuSXEH5Gp3bN7HXSrfYDmpJKBiwAMRNrcK7ceYCNWLk3qzF6PpQVwTzLjLNmPkNFXkYhRjZRg",
      "transaction": {
        "signatures": [
          "5VERn6FB9GNFP1VHuSXEH5Gp3bN7HXSrfYDmpJKBiwAMRNrcK7ceYCNWLk3qzF6PpQVwTzLjLNmPkNFXkYhRjZRg"
        ],
        "message": {
          "header": {
            "numRequiredSignatures": 1,
            "numReadonlySignedAccounts": 0,
            "numReadonlyUnsignedAccounts": 1
          },
          "accountKeys": ["from", "to", "systemProgram"],
          "recentBlockhash": "blockhash",
          "instructions": []
        }
      }
    }
  },
  "messageHashes": {
    "transfer": "message_to_sign_base58",
    "splTransfer": "spl_message_to_sign_base58"
  }
}

// solana/balances.json
{
  "native": {
    "address": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "balance": "1234567890",
    "decimals": 9,
    "formatted": "1.23456789",
    "usdValue": 123.45,
    "rent": "890880"
  },
  "tokens": [
    {
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "symbol": "USDC",
      "decimals": 6,
      "balance": "1000000000",
      "formatted": "1000.0",
      "tokenAccount": "token_account_address"
    }
  ]
}

// solana/rpc-responses.json
{
  "getBalance": {
    "jsonrpc": "2.0",
    "result": {
      "context": { "slot": 1 },
      "value": 1234567890
    },
    "id": 1
  },
  "getLatestBlockhash": {
    "jsonrpc": "2.0",
    "result": {
      "context": { "slot": 2 },
      "value": {
        "blockhash": "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
        "lastValidBlockHeight": 123456
      }
    },
    "id": 1
  },
  "sendTransaction": {
    "jsonrpc": "2.0",
    "result": "transaction_signature",
    "id": 1
  }
}
```

### THORChain (THOR) - Cosmos SDK Chain
**Chain ID**: thorchain
**Type**: Cosmos SDK
**Signature**: ECDSA

```json
// thorchain/addresses.json
{
  "valid": [
    {
      "address": "thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0",
      "publicKey": "thorpub1234567890abcdef1234567890abcdef12345678",
      "derivationPath": "m/44'/931'/0'/0/0",
      "prefix": "thor",
      "network": "mainnet"
    }
  ],
  "invalid": [
    "invalid_thor_address",
    "thor1invalid",
    "cosmos1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0", // Wrong prefix
    ""
  ]
}

// thorchain/transactions.json
{
  "unsigned": {
    "send": {
      "from": "thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0",
      "to": "thor1vlzlsjfx7nxfj5xdrxvlye93p0vafcawgh37vg",
      "amount": {
        "denom": "rune",
        "amount": "100000000"
      },
      "fee": {
        "amount": [{ "denom": "rune", "amount": "2000000" }],
        "gas": "200000"
      },
      "memo": "",
      "sequence": 0,
      "accountNumber": 12345
    },
    "swap": {
      "from": "thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0",
      "to": "thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0", // Pool address
      "amount": {
        "denom": "rune",
        "amount": "100000000"
      },
      "memo": "SWAP:BTC.BTC:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh:100000000",
      "fee": {
        "amount": [{ "denom": "rune", "amount": "2000000" }],
        "gas": "250000"
      }
    }
  },
  "signed": {
    "send": {
      "txhash": "ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890",
      "signature": {
        "pub_key": {
          "type": "tendermint/PubKeySecp256k1",
          "value": "pubkey_base64"
        },
        "signature": "signature_base64"
      }
    }
  }
}
```

## EVM Chain Family Fixtures

All EVM chains (Ethereum, Polygon, BSC, Avalanche, Arbitrum, Optimism, Base, Blast, zkSync) share the same address format but have different chain IDs and RPC endpoints.

```json
// Common EVM fixture template
{
  "chainId": 137, // Polygon example
  "addresses": {
    "// Same as Ethereum addresses - all EVM chains use same format"
  },
  "transactions": {
    "// Same structure as Ethereum but with chain-specific chainId"
  },
  "rpc": {
    "endpoint": "https://polygon-rpc.com",
    "chainId": 137,
    "symbol": "MATIC",
    "decimals": 18
  }
}
```

### EVM Chain IDs
- Ethereum: 1
- Polygon: 137
- Binance Smart Chain: 56
- Avalanche: 43114
- Arbitrum: 42161
- Optimism: 10
- Base: 8453
- Blast: 81457
- zkSync: 324

## Cosmos Chain Family Fixtures

All Cosmos SDK chains share similar structure but use different prefixes.

```json
// Common Cosmos fixture template
{
  "prefix": "cosmos", // Chain-specific prefix
  "addresses": {
    "valid": [
      {
        "address": "cosmos1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0",
        "prefix": "cosmos"
      }
    ]
  }
}
```

### Cosmos Prefixes
- Cosmos: cosmos
- THORChain: thor
- Osmosis: osmo
- Kujira: kujira
- dYdX: dydx
- Noble: noble

## Common Test Data

### common/mnemonics.json
```json
{
  "test_mnemonics": [
    {
      "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      "seed": "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
      "description": "Test vector from BIP39"
    }
  ]
}
```

### common/derivation-paths.json
```json
{
  "bitcoin": {
    "bip44": "m/44'/0'/0'/0/0",
    "bip49": "m/49'/0'/0'/0/0",
    "bip84": "m/84'/0'/0'/0/0"
  },
  "ethereum": {
    "default": "m/44'/60'/0'/0/0"
  },
  "solana": {
    "default": "m/44'/501'/0'/0'"
  },
  "cosmos": {
    "default": "m/44'/118'/0'/0/0"
  },
  "thorchain": {
    "default": "m/44'/931'/0'/0/0"
  }
}
```

### common/key-shares.json
```json
{
  "ecdsa": {
    "threshold": 2,
    "parties": 2,
    "localShare": "ecdsa_local_share_hex",
    "publicKey": "ecdsa_public_key_hex"
  },
  "eddsa": {
    "threshold": 2,
    "parties": 2,
    "localShare": "eddsa_local_share_hex",
    "publicKey": "eddsa_public_key_hex"
  }
}
```

## Vault Fixtures

### vaults/fast-vault.vult
```json
{
  "version": 2,
  "id": "vault_123456789",
  "name": "Test Fast Vault",
  "type": "fast",
  "threshold": 2,
  "publicKeyECDSA": "ecdsa_public_key",
  "publicKeyEdDSA": "eddsa_public_key",
  "chains": ["bitcoin", "ethereum", "solana"],
  "addresses": {
    "bitcoin": "bc1qaddress",
    "ethereum": "0xaddress",
    "solana": "solana_address"
  },
  "settings": {
    "hideBalance": false,
    "currency": "USD",
    "language": "en"
  }
}
```

## Server Response Fixtures

### server/fast-vault/create-response.json
```json
{
  "session_id": "abc123-def456-ghi789",
  "hex_encryption_key": "0x1234567890abcdef",
  "service_id": "service_123",
  "server_party_id": "server",
  "status": "pending"
}
```

### server/message-relay/session.json
```json
{
  "session_id": "relay_session_123",
  "participants": ["client", "server"],
  "messages": [],
  "status": "active",
  "created_at": "2024-01-01T00:00:00Z",
  "expires_at": "2024-01-01T00:05:00Z"
}
```

## Validation Rules

Each fixture file MUST:

1. Be valid JSON
2. Include all required fields
3. Use correct data types
4. Match blockchain specifications
5. Include both mainnet and testnet examples where applicable
6. Provide sufficient variety for testing edge cases

## Fixture Generation Scripts

```typescript
// tests/scripts/generate-chain-fixtures.ts
import { generateBitcoinFixtures } from './generators/bitcoin';
import { generateEthereumFixtures } from './generators/ethereum';
import { generateSolanaFixtures } from './generators/solana';
// ... import all chain generators

async function generateAllFixtures() {
  const chains = [
    'bitcoin', 'ethereum', 'solana', 'thorchain', 'ripple',
    'cosmos', 'polygon', 'binance-smart-chain', 'avalanche',
    'arbitrum', 'optimism', 'base', 'blast', 'zksync',
    'litecoin', 'dogecoin', 'bitcoin-cash', 'dash',
    'osmosis', 'kujira', 'dydx', 'noble',
    'tron', 'sui', 'polkadot', 'near', 'ton'
  ];

  for (const chain of chains) {
    console.log(`Generating fixtures for ${chain}...`);
    await generateChainFixtures(chain);
  }
}
```

## Fixture Validation

```typescript
// tests/scripts/validate-fixtures.ts
import Joi from 'joi';

const addressSchema = Joi.object({
  valid: Joi.array().items(
    Joi.object({
      address: Joi.string().required(),
      publicKey: Joi.string().required(),
      derivationPath: Joi.string().required()
    })
  ).required(),
  invalid: Joi.array().items(Joi.string()).required()
});

const transactionSchema = Joi.object({
  unsigned: Joi.object().required(),
  signed: Joi.object().required(),
  messageHashes: Joi.object().required()
});

function validateChainFixtures(chain: string) {
  const fixtures = loadFixtures(chain);

  // Validate each fixture file
  validateSchema(fixtures.addresses, addressSchema);
  validateSchema(fixtures.transactions, transactionSchema);
  // ... validate all fixtures
}
```

## Maintenance

### Monthly Updates Required

1. **Address Formats**: Check for any chain updates
2. **Transaction Formats**: Update for protocol changes
3. **RPC Responses**: Sync with latest API versions
4. **Balance Formats**: Update token lists and decimals
5. **Gas/Fee Estimates**: Update with current network conditions

### Automation

- Use GitHub Actions to validate fixtures on every PR
- Automated alerts for chain protocol updates
- Regular fixture regeneration from live blockchain data
- Compatibility testing with actual blockchain nodes

---

*This specification ensures comprehensive test coverage for all 30+ supported blockchains with realistic, maintainable test data.*