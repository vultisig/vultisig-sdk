---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

feat(near): native NEAR send path

Adds the native NEAR vertical slice on top of the frozen signing inputs: an
account-ID grammar check, typed read-only JSON-RPC (account, access key, final
block, protocol config), the raw unlocked balance, preparation that freezes the
access-key nonce, final block hash and upfront gas reservation, NEAR's fee and
MAX (balance minus the gas reservation and the storage the account must keep
backing), a locally derived transaction hash, broadcast bound to that hash, and
finality-checked status. Preparation refuses a named receiver that does not
exist with `BuildKeysignPayloadError` type `near-destination-not-found`; a
64-hex implicit receiver is created by the transfer and skips that read.

Fee arithmetic is transcribed from nearcore protocol 86: `total_cost` is
converted-receipt gas burnt at the block's price plus receipt gas purchased at
`max(block price, min_gas_purchase_price)` plus the transfer amount, and a
64-hex implicit receiver reserves the account-creation and full-access-key gas
whether or not it exists. `account_creation_charge` is collected out of the
executed receipt's gas refund and is deliberately not added here. NEAR is not
added to the default onboarding chains, it is excluded from seedphrase import
until its key derivation is wired, and NEP-141 tokens and NEP-518
`0x`/NEP-616 `0s` account families are unsupported.

Native NEAR swaps run through SwapKit's NEAR-Intents provider in both
directions. As a source, a swap is a `simpleTransfer` deposit to a per-swap
implicit account (requested with `disableBuildTx`), signed as the plain
transfer it names: the NEAR signer accepts a SwapKit payload only when its
target and amount equal the transfer's and it carries no pre-built bytes,
transaction type or memo. Building a NEAR-source swap refuses a deposit that,
with the gas reservation and the storage reserve, exceeds the balance, with the
same `not-enough-funds` shortfall a send raises, before any signing starts.
