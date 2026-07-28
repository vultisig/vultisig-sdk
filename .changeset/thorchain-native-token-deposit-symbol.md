---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(thorchain): don't append the bank denom to a native-token swap deposit symbol

A swap sourced from a THORChain-native token (TCY, RUJI) encoded its
`MsgDeposit` asset as `` `${ticker}-${contractAddress}` `` — and for these coins
`contractAddress` IS the bank denom, so the deposit went out as `TCY-tcy`
instead of `TCY`. iOS (`thorchain.swift` `getSwapPreSignedInputData`) and
Android (`ThorchainSwapHelper`) both encode the bare ticker.

Because the symbol is part of the signed pre-image, this moved the hash: a
co-signing joiner rebuilds the payload locally and polls the relay with
`messageId = getMessageHash(message)`, so it asked for a `message_id` the
initiator never uploaded and failed with
`404 Timed out while waiting for setup message`. Reported in
vultisig/vultisig-windows#4464 as a TCY -> RUNE swap that fails whenever the
extension co-signs and succeeds against an Apple co-signer.

The `TICKER-CONTRACT` form is now gated on `secured`, which is the case it was
written for (vultisig-sdk `5a8aacdeb`): a secured-asset withdrawal, where the
auxiliary coin is the L1 token being pulled off THORChain and the contract
address genuinely belongs in the symbol (`USDC` + `0xa0b8…` ->
`USDC-0XA0B8…`, matching THORNode's `ETH.USDC-0XA0B8…`). Both sides of that
gate are now covered by tests; RUNE, secured assets, and non-swap deposits
(bond/merge/stake) were never affected.
