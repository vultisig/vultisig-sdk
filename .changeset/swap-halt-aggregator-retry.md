---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(swap): stop reporting a native trading halt when an aggregator could still fill

`findSwapQuotes` collapsed a THORChain/MayaChain halt plus a transient aggregator failure into `TradingHalted` for the whole pair, so an ETH→SOL quote surfaced "trading halted" whenever LiFi/SwapKit happened to time out. A halt is scoped to the native protocol that raised it: those aggregators now get one automatic re-attempt, and when they are still unreachable the error reports the transient failure instead of a halt the user cannot retry out of. Halt-only pairs still throw `TradingHalted`.
