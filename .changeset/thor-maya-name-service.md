---
'@vultisig/core-chain': minor
---

Resolve send recipients typed as names: `.thor` (THORName, on THORNode), `.maya` (MAYAName, on MAYANode) and `.eth` (ENS, Ethereum only). `getNameServiceName` reads a typed recipient as a name by its suffix, `getBareNameServiceName` reads one typed without a suffix as a name of the chain's own service (a THORName on THORChain, a MAYAName on MayaChain, an ENS name on Ethereum), `isNameServiceChain` says whether its service can hold an address for a chain, and `resolveNameServiceName` returns the name's address on that chain, or `notFound` / `noAddressForChain`. A name that was never registered and an expired one are both `notFound`; a node that cannot be reached throws instead of reporting the name missing.
