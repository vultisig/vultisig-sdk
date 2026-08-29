---
'@vultisig/sdk': minor
---

Export the Cardano transaction-validity policy: `getCardanoSendTtl`, `cardanoSlotOffset` and `cardanoBroadcastTtlSafetyMargin` are now reachable from the root and React Native entries. The TTL policy existed only inside the keysign resolver, so consumers building a Cardano transaction had no way to import it and hardcoded their own slot offset instead - which is how vultiagent-app ended up 10x off the value its own broadcast freshness guard judges transactions by. The keysign resolver now calls the same helper rather than re-deriving the offset.
