---
"@vultisig/sdk": minor
---

feat(cosmos): parameterize the THORChain-family MsgDeposit asset (THOR.RUNE / MAYA.CACAO)

`buildThorchainDepositTx` gains an optional `asset` ({ chain, symbol, ticker }) that
defaults to THOR.RUNE, so every existing caller is byte-identical. MayaChain-source
swaps pass MAYA.CACAO, enabling native CACAO->RUNE (and RUNE-source) deposit swaps in
the app's react-native signing path (previously hardcoded THOR.RUNE, which would sign
the wrong asset for a Maya deposit).
