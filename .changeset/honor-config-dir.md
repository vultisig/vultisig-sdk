---
'@vultisig/client-shared': patch
---

Honor `VULTISIG_CONFIG_DIR` in the shared `config-store` (vault registry). Previously the
registry path (`config.json`) was hardcoded to `~/.vultisig` at module load and ignored the
env var, while `credential-store` honored it — so in Docker/CI with a custom config dir the
credentials and the vault registry diverged and a loaded wallet became invisible. The config
dir is now resolved at call time, matching `credential-store`, so both co-locate.
