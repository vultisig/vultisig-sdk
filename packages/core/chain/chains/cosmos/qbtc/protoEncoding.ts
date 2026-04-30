/**
 * @deprecated Import from `@vultisig/core-chain/chains/cosmos/protoEncoding`.
 *
 * This subpath used to host the QBTC-specific manual protobuf encoders. The
 * helpers were lifted to the shared `cosmos/protoEncoding` module so non-QBTC
 * cosmos message builders (e.g. IBC `MsgTransfer` in vultiagent-app#303) can
 * consume the same canonical primitives. This shim preserves the old import
 * path so external consumers don't break — the wire bytes are unchanged.
 *
 * Removing this shim would be a breaking package-export change and must wait
 * until a major version bump.
 */
export {
  concatBytes,
  protoBytes,
  protoString,
  protoVarint,
} from '../protoEncoding'
