---
'@vultisig/sdk': patch
---

Fix a token-spoofing gap in `resolveTokenRef`: an EVM-address-shaped ref (e.g. `send({ symbol: '0xA0b8…' })`) now matches the vault's own tokens by contract address BEFORE symbol. Previously symbol was tried first even for address-shaped refs, so a poisoned/airdropped vault token whose attacker-controlled `symbol` field was set to a real token's address string (e.g. USDC's contract address) could hijack a ref the caller typed as a genuine address, resolving the send to the scam contract with the scam token's decimals instead.
