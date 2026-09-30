---
"@vultisig/sdk": minor
"@vultisig/cli": minor
---

feat(seedphrase): accept every BIP39 mnemonic length (12, 15, 18, 21 and 24 words) in seedphrase validation, import and the CLI prompt. `SEEDPHRASE_WORD_COUNTS` is now `[12, 15, 18, 21, 24]`, which widens `SeedphraseWordCount`.
