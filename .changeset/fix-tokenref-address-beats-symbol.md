---
'@vultisig/sdk': patch
---

Fix an address-spoofing surface in `resolveTokenRef`. Vault token symbols are attacker-controlled strings persisted from on-chain discovery, and the resolver tried symbol before contract address - so a scam token whose `symbol` field is set to the literal text of a real token's contract address captured a send in which the victim typed that genuine address correctly, resolving decimals, amount and the keysign target to the scam contract. Address-shaped refs are now matched by address/id only and never by symbol; plain ticker refs are unchanged. Address-shaped refs threw entirely before this resolver existed, so nothing that previously resolved changes.
