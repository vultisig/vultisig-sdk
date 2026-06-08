---
'@vultisig/core-chain': minor
'@vultisig/sdk': patch
---

Add Sui dApp signing helpers to `@vultisig/core-chain/chains/sui`. Two new
public modules:

- `./chains/sui/sign` exports `suiTransactionDataIntent` /
  `suiPersonalMessageIntent` (defensive clones of the 3-byte intent
  prefixes), `getSuiTransactionDataDigest(txBytes)` and
  `getSuiPersonalMessageDigest(messageBytes)` for the intent-prefixed
  blake2b-256 digests the wallet's Ed25519 signer signs, and
  `buildSuiSerializedSignature({ signature, publicKey })` for the 97-byte
  `flag(1) || sig(64) || pubkey(32)` Wallet Standard wire signature.

- `./chains/sui/buildTransactionFromJson` exports
  `buildSuiTransactionFromJson({ transactionJson, sender })` which hydrates
  a serialized Sui `Transaction` (V1 or V2 JSON) and resolves it to BCS
  bytes via `Transaction.build({ client: getSuiClient() })`. Lets
  extension callers move the build step off the dApp page (where the dApp
  page's Content Security Policy blocks the Sui RPC) and into the
  extension's own context.
