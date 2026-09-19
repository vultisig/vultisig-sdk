---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(tron): reject incomplete `getnowblock` / `getblockbynum` responses instead of zeroing the TAPOS header

`getTronBlockInfo` defaulted every missing `block_header.raw_data` field to `0` / `''`, so a partial gateway response (or an `{Error}`-on-200 envelope) produced an all-zero header. WalletCore derived `ref_block_bytes` / `ref_block_hash` from it, the full MPC ceremony ran (including a Fast-Vault server co-sign), and the transaction could only fail on broadcast with `TAPOS_ERROR`. Both fetches now surface the gateway error message and reject any response missing `blockID` or a complete `raw_data`, before any signing starts. Header identifier fields (`txTrieRoot`, `parentHash`, `witness_address`) must also be hex of the exact protocol byte length, since `Buffer.from(value, 'hex')` would otherwise silently truncate malformed strings into the same broken header.
