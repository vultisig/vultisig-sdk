---
"@vultisig/core-chain": patch
---

fix(cosmos): bump TerraClassic staking gas limit from 2M to 3M

The 2M limit was consistently failing with "out of gas in location:
ValuePerByte" on TerraClassic MsgDelegate / MsgUndelegate / claim-rewards
txs (gasUsed: 2000201-2000774). The ValuePerByte meter in the classic-terra
treasury/tax post-handler adds ~200-800 gas on top of the base delegate
cost, which the standard SDK estimate doesn't account for. 3M fits safely
within the 100 LUNC fee floor (3M * 28.325 uluna/gas ≈ 84.97 LUNC < 100
LUNC).
