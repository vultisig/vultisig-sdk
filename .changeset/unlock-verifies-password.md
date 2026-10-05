---
'@vultisig/sdk': patch
---

fix(vault): `unlock()` now verifies the password even when key shares are already loaded, and a wrong password no longer replaces or clears a previously cached one
