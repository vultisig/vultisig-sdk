---
'@vultisig/sdk': minor
---

Export the validation and address-format canonicals from the React Native entry: `amountMatches`, `feeMatches`, `normalizeTokenSymbol`, `tokenDecimals`, `scaleHumanToRaw`, `scaleRawToHuman`, `decimalsFor`, `computeEvmFee`, `isValidTokenSymbolFormat`, `ValidateNormalizerError`, `canonicalChainTag`, `classifyAddress`, `isAddressValidForChain`, `isSolanaAddress`, `supportedChainTags`, `address`, `validate` and `checkChainPrefix`. They are pure, vault-free and platform-neutral, but were reachable only from the root entry, so React Native consumers had to deep-import or keep an app-local mirror. Adds an RN entry test that walks the whole runtime surface of each canonical module, so a helper added later and wired only into the root entry fails rather than silently reopening the gap.
