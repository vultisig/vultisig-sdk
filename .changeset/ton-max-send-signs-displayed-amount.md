---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(ton): a MAX send signs the amount it displayed, and MAX is no longer guessed

A TON MAX send showed the user `balance - fee` and then signed something else: `amount = 0` under `ATTACH_ALL_CONTRACT_BALANCE`, which tells the wallet contract to sweep whatever the balance happens to be when the transaction executes. Worse, nothing marked a send as MAX — it was inferred from `amount + fee >= balance`, so an ordinary send that landed near the balance was silently upgraded to a full-balance sweep.

The signing path now always signs `keysignPayload.toAmount` under `PAY_FEES_SEPARATELY`, for MAX and ordinary sends alike; a MAX send is just `balance - fee` as an ordinary amount, and that fee is the reserve the send mode draws on. The signed bytes no longer depend on the flag at all.

`sendMaxAmount` becomes an explicit input threaded from the caller (`prepareSendTx` / `prepareSendTxFromKeys` / `buildSendKeysignPayload` → `getChainSpecific`), defaulting to `false`, and is recorded in `TonSpecific` as description rather than instruction. Removing the inference also drops a balance lookup from every TON send.

TON MAX sends that previously relied on the sweep to cover an amount larger than `balance - fee` will now fail on chain instead of moving more than was shown. Callers should pass the displayed `balance - fee` as `amount` and set `sendMaxAmount: true` alongside it.
