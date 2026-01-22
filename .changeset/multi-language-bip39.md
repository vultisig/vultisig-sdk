---
"@vultisig/sdk": minor
---

feat(sdk): add multi-language BIP39 mnemonic support

**New Features:**
- Support for all 10 BIP39 languages: English, Japanese, Korean, Spanish, Chinese (Simplified/Traditional), French, Italian, Czech, Portuguese
- Auto-detection of mnemonic language during validation
- Explicit language validation with `{ language: 'japanese' }` option
- Word suggestions for autocomplete with `getSuggestions(prefix, language)`
- Japanese ideographic space (U+3000) handling
- Proper Unicode NFKD normalization

**New Exports:**
- `Bip39Language` - Union type of supported languages
- `BIP39_LANGUAGES` - Array of supported language codes
- `SeedphraseValidationOptions` - Options for explicit language validation
- `detectMnemonicLanguage()` - Detect language from mnemonic
- `getWordlist()` - Get wordlist for a specific language
- `BIP39_WORDLISTS` - Map of all wordlists
- `normalizeMnemonic()` - Normalize mnemonic with Unicode handling

**API Usage:**
```typescript
// Auto-detect language
const result = await sdk.validateSeedphrase(japaneseMnemonic)
console.log(result.detectedLanguage) // 'japanese'

// Explicit language
const result = await sdk.validateSeedphrase(mnemonic, { language: 'korean' })
```
