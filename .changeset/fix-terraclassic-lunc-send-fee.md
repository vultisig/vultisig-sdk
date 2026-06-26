---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

Lower `cosmosGasRecord[TerraClassic]` from 100 LUNC to 20 LUNC.

Real on-chain MsgSend cost on columbus-5: ~400k gas x 28.325 uluna/gas ~ 11.33 LUNC.
The 100 LUNC floor was blocking sends from wallets with 20-100 LUNC balance even when
the transaction would have succeeded. The new 20 LUNC floor gives a ~1.77x buffer.

Companion to vultisig/agent-backend#1409 and vultisig/mcp-ts#594.
