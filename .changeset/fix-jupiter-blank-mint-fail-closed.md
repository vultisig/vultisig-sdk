---
'@vultisig/sdk': patch
---

Fix `buildJupiterSwapTx` silently quoting native SOL for a blank mint string. `contractAddress?.trim() || SOL_NATIVE_MINT` collapsed an OMITTED parameter (explicit native-SOL intent) with a present-but-empty one, so a consumer whose token resolution returned `''` on a lookup miss got a valid **SOL** swap quote instead of a deterministic error - "swap 100 USDC for X" with a failed USDC resolution builds a quote for 100 SOL. The same-mint guard does not catch it, since the other side is normally a real mint. Omission still means native SOL; a blank string now fails closed and names which side failed to resolve.
