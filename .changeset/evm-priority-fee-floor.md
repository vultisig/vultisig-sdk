---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Floor the signed EVM `maxPriorityFeePerGas` on tip-auction chains: 1 gwei on
Ethereum (parity with iOS `FeeService.calculateMaxPriorityFeePerGas` and
Android `EthereumFeeService`, which both floor at 1 gwei) and 30 gwei on
Polygon (validators enforce a ~25 gwei minimum tip). In quiet fee markets the
raw `eth_maxPriorityFeePerGas` suggestion collapses to near zero (~0.0004 gwei
observed live), and a tx signed with that tip is never picked up by block
builders — it sat in the public mempool until evicted, so Ethereum mainnet
sends from extension/desktop broadcast fine but vanished unmined. Rollup L2s
and the zkSync `estimateFee` path keep their current no-floor behavior, and
explicit user fee settings still bypass the clamp (vultisig-sdk#1659).
