---
'@vultisig/sdk': minor
---

Add `sdk.cosmos.gov`: `getCosmosGovernanceProposals` (read-only LCD fetch of governance proposals across IBC-enabled Cosmos chains, gov/v1 with v1beta1 fallback) and `prepareCosmosVote` (builds an unsigned `cosmos-sdk/MsgVote` envelope — validates the voter bech32/HRP, fetches account_number/sequence, fails closed on funded-but-unparseable accounts; never signs or broadcasts). Exported from the generic and React Native entry points.
