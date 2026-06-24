---
'@vultisig/sdk': minor
---

feat(sdk): add `sdk.defi.pendle` — UNSIGNED Pendle PT (Principal Token) buy/sell/redeem builders wrapping the Pendle Hosted SDK Convert REST API. Router target is allow-listed to Pendle Router V4, market/PT/underlying are trust-but-verified against the live active-market catalog, and the prerequisite ERC20 approve calldata is hand-encoded with strict bounds. Builds calldata only — never signs, never broadcasts. First protocol under the new `sdk.defi.*` namespace.
