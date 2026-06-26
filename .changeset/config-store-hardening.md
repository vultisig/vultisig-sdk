---
'@vultisig/client-shared': patch
---

Harden the vault-registry config store (`config-store.ts`):

- `loadConfig` now warns to stderr (naming the path and parse error) when
  `config.json` is corrupted instead of silently reverting to an empty
  registry, and leaves the bad file intact at load time (the next saveConfig
  still overwrites it once the user mutates state — this is not durable
  recovery). A missing file is still treated as the normal first-run case (no
  warning).
- `saveConfig` now writes `config.json` with `0o600` perms (and `chmod`s on
  every write, since the mode is only honored on create) and creates the
  config dir with `0o700`, mirroring credential-store's hardening.
