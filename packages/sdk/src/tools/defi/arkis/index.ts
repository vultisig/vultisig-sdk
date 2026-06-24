// sdk.defi.arkis — Arkis lender-side supply surface.
//
// Builds UNSIGNED Arkis supply calldata only (ERC-20 approve + ERC-4626 /
// Agreement deposit). Never signs, never broadcasts. Multi-consumer: no
// affiliate/consumer identity is hardcoded.
export { ARKIS_BOOK_URLS, ARKIS_OFFICIAL_ADDRESSES } from './addresses'
export {
  type ArkisPoolKind,
  type ArkisUnsignedTx,
  type BuildArkisSupplyParams,
  type BuildArkisSupplyResult,
  buildArkisSupplyTx,
} from './buildSupplyTx'
export { parseArkisTokenAmount } from './parseTokenAmount'
export { resolveArkisPoolKind, type ResolveArkisPoolKindResult } from './resolvePoolKind'
