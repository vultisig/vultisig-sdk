---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(cardano): produce broadcastable bodies for native-token sends.

The previous Cardano signing-input resolver shipped lovelace-only inputs and never called `AnySigner.plan(...)`, so every CNT send produced a body with `fee = 0` and the recipient output's lovelace set to the *token amount* (because `transferMessage.amount = keysignPayload.toAmount`, and `toAmount` for a CNT send is in the token's base units). Both broke broadcast — Ogmios returns 3122 (insufficient fee) or 3125 (insufficiently funded outputs); the keysign protocol itself completes because both peers hash the same broken body. Closes vultisig/vultisig-sdk#429.

`getCardanoSigningInputs` now: (1) reads per-`TxInput.tokenAmount` from `keysignPayload.utxoInfo[i].cardano_tokens` so the planner can balance CNT inputs against the bundle output, (2) calls `AnySigner.plan(...)` and assigns `input.plan` (WalletCore reads the body's fee from `plan.fee`, not from `transferMessage.forceFee`), (3) for CNT sends overrides `transferMessage.amount` to a 1.5 ADA min-UTxO floor so the recipient output passes Cardano's per-output min-UTxO check, and (4) forces `useMaxAmount = false` for CNT sends so the signer doesn't drain ADA into the recipient output.

Per-UTXO token data crosses the wire via the new `UtxoInfo.cardano_tokens` field (commondata#75). The initiator (the app that builds the keysign payload) fetches extended UTXOs from Koios once and serialises tokens onto each `UtxoInfo`; both MPC peers read identical bytes from the payload, so `AnySigner.plan(...)` picks the same selection on both sides (WalletCore's Cardano coin-selection is largest-first deterministic — `Cardano/Signer.cpp::selectInputsSimpleNative` / `selectInputsSimpleToken`). The resolver stays synchronous; no async dispatcher is needed.
