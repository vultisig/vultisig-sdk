---
'@vultisig/rujira': major
---

Require a fresh FIN registry lookup on the same client before creating or funding range positions. Reuse the resolved contract and exact ordered native denominations. Funding builders remain synchronous but now reject missing or expired verification, mismatched contracts and denomination aliases. Refresh discovery after five minutes before rebuilding. This adds a runtime precondition for callers that previously built directly from addresses or configuration.

Traverse the complete cursor-paginated FIN pair connection instead of treating the top 200 volume-ranked markets as exhaustive. Reject incomplete pagination and conflicting source data before activating a snapshot.
