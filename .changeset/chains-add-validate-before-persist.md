---
"@vultisig/cli": patch
---

fix(chains): validate `chains --add <chain>` against the registry before persisting

An invalid `chains --add fakechain` correctly reported INVALID_CHAIN but still wrote
"fakechain" to the vault's chain list (chain resolution falls back to the raw user
string when the name doesn't match the registry). Every subsequent address-deriving
command then re-derived the bogus chain and dumped a stack trace to stderr until it was
manually removed. The `--add` path now validates against the supported-chain registry
first and fails closed — nothing is persisted for an unsupported chain.
