---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

publish dedicated `@vultisig/sdk/tx` and `@vultisig/sdk/tools/decode` subpaths so consumers can import the canonical tx-normalization and tool-result decoding helpers without deep imports or the full root surface.
