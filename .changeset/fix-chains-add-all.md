---
"@vultisig/cli": minor
---

Add `--add-all` flag to chains command to add all supported chains at once

New vaults start with only 5 default chains, but the SDK supports 36 chains. Users previously had to run `chains --add <chain>` 31 times to enable all chains. Now they can simply run:

```bash
vultisig chains --add-all
```

This works in both CLI mode and interactive shell mode.
