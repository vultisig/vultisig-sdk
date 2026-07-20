---
'@vultisig/sdk': patch
---

Re-check THORChain/MayaChain trading-halt flags at broadcast on BOTH ends of the native swap route, not only the source chain. A chain healthy at quote time can `HALT<CHAIN>TRADING` before broadcast while the inbound vault address stays current; a destination halt would otherwise let the deposit land while the outbound cannot leave (stuck funds). Mirrors quote-time `getNativeSwapTradingHalt`'s source+destination selection and its tolerance (a route leg with no inbound entry is skipped, not false-blocked), and reads `global_trading_paused` across all inbound entries. Fail-closed at zero extra network cost (the flags ride the already-fetched inbound object).
