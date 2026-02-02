---
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

fix: address code review items across SDK and CLI

**CLI improvements:**
- Fix Phantom path detection message to use effective flag value
- Add ambiguous vault detection in delete command with descriptive error messages
- Refactor `findVaultByIdOrName` to use object parameter and throw on ambiguous matches
- Import tier config from SDK instead of hardcoding values in discount command

**SDK improvements:**
- Export VULT discount tier configuration for CLI consumption
- Add error handling in SwapService using attempt/withFallback pattern

**Documentation fixes:**
- Add `text` language identifier to code fence in CLI README
- Remove redundant "originally" word from Phantom wallet descriptions
- Update "affiliate fee discounts" to "swap fee discounts" terminology
