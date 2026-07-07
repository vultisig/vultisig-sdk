---
"@vultisig/sdk": patch
---

fix(cosmos): harden chain/denom/id dispatch against undefined inputs

Guards cosmos balance resolvers, token metadata resolvers, and public-key
lookup against undefined chain, denom, or address inputs that would otherwise
throw at runtime or return stale data. Defensive undefined checks added across
the cosmos resolver layer.
