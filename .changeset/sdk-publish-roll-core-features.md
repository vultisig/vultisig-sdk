---
'@vultisig/sdk': patch
---

Republish the `@vultisig/sdk` bundle so consumers (mcp-ts, vultiagent-app) pick up the latest `@vultisig/core-chain` features that landed without an `@vultisig/sdk` changeset:

- `resolveTokenPriceId(chain, denomOrAddress?)` helper for registry-driven token price resolution ([#587](https://github.com/vultisig/vultisig-sdk/pull/587))
- LiFi stable-pair slippage tuning ([changeset](.changeset/lifi-stable-pair-slippage.md))
- Plus any other pending `@vultisig/core-chain` minors that have been merged without a corresponding sdk-package changeset.

Pure repackage — no consumer-facing API change; the bundle just embeds the latest core-chain dist.
