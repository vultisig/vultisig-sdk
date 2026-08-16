---
'@vultisig/sdk': patch
---

Add `cronoschain` / `cronos chain` -> `cronos` to the StakeKit network alias map. `CronosChain` is the SDK's own canonical `Chain` id and was the one canonical id in StakeKit's supported set that did not round-trip: `balances({ network: 'CronosChain' })` sent the literal `cronoschain` upstream as an unknown slug and returned `[]`, which reads as "you hold nothing on Cronos" rather than "that network name was not understood".
