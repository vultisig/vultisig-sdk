---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(cardano): produce broadcastable bodies for native-token sends.

The previous Cardano signing-input resolver shipped lovelace-only inputs and never called `AnySigner.plan(...)`, so every CNT send produced a body with `fee = 0` and the recipient output's lovelace set to the *token amount* (because `transferMessage.amount = keysignPayload.toAmount`, and `toAmount` for a CNT send is in the token's base units). Both broke broadcast — Ogmios returns 3122 (insufficient fee) or 3125 (insufficiently funded outputs); the keysign protocol itself completes because both peers hash the same broken body. Closes vultisig/vultisig-sdk#429.

`getCardanoSigningInputs` now: (1) fetches extended UTXOs from Koios and populates per-`TxInput.tokenAmount` so the planner can balance CNT inputs against the bundle output, (2) calls `AnySigner.plan(...)` and assigns `input.plan` (WalletCore reads the body's fee from `plan.fee`, not from `transferMessage.forceFee`), (3) for CNT sends overrides `transferMessage.amount` to a 1.5 ADA min-UTxO floor so the recipient output passes Cardano's per-output min-UTxO check, and (4) forces `useMaxAmount = false` for CNT sends so the signer doesn't drain ADA into the recipient output.

Resolver is now async; introduces `getEncodedSigningInputsAsync` for the keysign flow (`cosigner`, `TransactionBuilder`, `BroadcastService`) and keeps the sync `getEncodedSigningInputs` for non-Cardano callers (Blockaid, since Cardano isn't a supported chain there). New `AsyncSigningInputsResolver<T>` type for chain-specific resolvers that need async work; `SigningInputsResolver<T>` stays sync.
