---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': patch
---

Add `buildLimitSwapKeysignPayload`, the step that turns a THORChain `=<` limit-order memo into a signable transaction.

`buildLimitSwapMemo` produced the memo and `getThorchainMemoAsset` the asset notation, but nothing carried either into a `KeysignPayload` — limit orders could be composed and never placed. This builder branches on the source asset, mirroring iOS `LimitSwapPayloadAssembler`:

- **Native RUNE** — `MsgDeposit` on THORChain itself; no inbound vault, `toAddress` carries the signer's own address as the placeholder the Cosmos signer ignores.
- **Native gas asset** — transfer to the live Asgard inbound vault with the memo in tx `data` / `OP_RETURN`, no swap payload.
- **ERC20** — the router's `depositWithExpiry` call plus an `approve` when allowance is short, both in one ceremony. A token source signed without a swap payload would fall through to a plain ERC-20 transfer, dropping the memo and stranding the tokens on the router.

Every gate fails closed: the `EnableAdvSwapQueue` mimir is re-checked at sign time (it can flip while the user sits on Verify, and a `=<` order on a network with the queue off can execute as an unprotected market swap), the memo must actually be a limit memo, RUNE deposits are blocked on THORChain's global trading pause — including when the inbound list is unverifiable, since RUNE bypasses the per-chain halt filter entirely — and external sources must resolve a live, non-halted inbound whose address is then used as the destination.

Also exports `getAdvancedSwapQueueEnabled` (the mimir gate), `findLimitSwapInbound` / `shouldBlockRuneDeposit` (pure inbound selection), and `assertLimitSwapMemo`.

`assertValidThorchainDepositMemo` is deliberately unchanged: it guards the standalone `prepareThorchainMsgDepositTxFromKeys` tool and is not on the keysign-payload path, so excluding swap-shaped memos there stays correct.

No EVM gas-limit override is applied. iOS pins a native-EVM limit deposit to 120000 to match its own market path, but here both paths put the memo on `keysignPayload.memo` and neither sets a general swap payload, so both already floor at `deriveEvmGasLimit`'s 600000 data-tx limit. Forcing 120000 would make the limit path diverge from the market path and risk under-gassing.
