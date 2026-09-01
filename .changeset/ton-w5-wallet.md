---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

feat(ton): W5 (wallet v5r1) support as an explicit per-account opt-in

Every Vultisig TON account has been hard-pinned to the V4R2 wallet contract. W5 is the default for new wallets in Tonkeeper and Telegram Wallet and is the gateway to what users now expect from TON — up to 255 messages per request instead of 4, lower fees, and relayer-paid ("gasless") transactions. WalletCore has supported it for a while; nothing here used it.

A W5 wallet is a *different address* for the same key, with its own balance, so this is not a switch: V4R2 stays the default everywhere and W5 is selected per account.

- `@vultisig/core-chain/chains/ton/wallet` (new): `TonWalletVersion` (`'v4r2' | 'v5r1'`), `deriveTonAddress` for either contract, `resolveTonWalletVersion` to tell which contract an address is for a key, the W5 mainnet wallet id, and the per-contract message limits.
- `deriveAddress` / `getChainAddress` / `deriveAddressFromKeys` / `vault.address(chain, { tonWalletVersion })` accept the wallet version, so a client can show both accounts side by side for a migration flow.
- The keysign signing-input resolver derives the contract from the sender address — the payload has no wallet-version field, and every co-signer reaches the same answer from the shared vault key — and refuses an address that is neither of the key's wallets rather than assuming V4R2. W5 requests carry `IGNORE_ACTION_PHASE_ERRORS`, which the W5 code requires of every external action (its replay protection) and WalletCore enforces; the TON status resolver's action-phase check covers the blindness that flag would otherwise cause. Message counts are capped per contract.
- The RN-safe builders (`buildTonSendTx`, `buildTonJettonTransferTx`, `buildTonTxFromSigningPayload`, `deriveTonAddress`, `prepareJettonTransferTxFromKeys`) take `walletVersion`; W5 uses the `signed_external` request layout with the signature appended, byte-identical to WalletCore. New `buildV5R1Wallet` / `TON_V5R1_WALLET_ID` alongside the V4R2 helpers.

Golden vectors (`testdata/cross-encoder-golden/ton-w5-*.json`) pin the W5 pre-images and are verified against real WalletCore, including the full signed external message. Client-side migration UI (show both accounts, move funds, reconnect dApps) is separate work per platform.
