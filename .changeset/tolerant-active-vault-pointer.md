---
"@vultisig/cli": patch
---

Tolerate a corrupt `activeVaultId.json` at startup. A truncated or unparseable
active-vault pointer used to throw during CLI initialization, which broke every
command — including `vultisig vaults`, the one you run to recover. The pointer
read now fails open (treated as "no active vault") and self-heals by clearing
the bad pointer, so vaults still list with none marked active.
