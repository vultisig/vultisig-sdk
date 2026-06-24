---
'@vultisig/sdk': minor
---

feat(prep): add `sdk.prep.cosmosStaking` — pure-crypto unsigned msg-envelope builders for cosmos-sdk staking + distribution.

New public surface `cosmosStaking.{delegate,undelegate,redelegate,withdraw}` (plus the named `buildDelegateMsg` / `buildUndelegateMsg` / `buildRedelegateMsg` / `buildWithdrawRewardsMsg` exports) builds the proto-`Any` (typeUrl + base64 protobuf value) for `MsgDelegate` / `MsgUndelegate` / `MsgBeginRedelegate` / `MsgWithdrawDelegatorReward`. Quotes/builds-unsigned only — never signs or broadcasts. Consolidates the proto-`Any` encoding that mcp-ts `build_cosmos_*` and the app previously re-derived independently into one SDK code path.
