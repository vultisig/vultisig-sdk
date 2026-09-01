---
"@vultisig/mpc-types": minor
"@vultisig/core-chain": patch
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
---

Make the SDK package graph explicit and acyclic. Shared Bitcoin signing protobuf schemas now live in `@vultisig/mpc-types`, `@vultisig/core-mpc` preserves its existing schema subpath as a compatibility export, and SDK builds resolve the declared core packages through their published export maps.
