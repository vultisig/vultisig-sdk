/** ZK circuit used for the claim proof. */
export type QbtcClaimCircuit = 'ecdsa' | 'schnorr'

/** Supported Bitcoin address types for QBTC claiming. */
export type BtcAddressType =
  | 'p2pkh'
  | 'p2wpkh'
  | 'p2sh-p2wpkh'
  | 'p2wsh'
  | 'p2tr'

/** Maps a Bitcoin address type to its corresponding ZK circuit. */
export const btcAddressTypeCircuit: Record<BtcAddressType, QbtcClaimCircuit> = {
  p2pkh: 'ecdsa',
  p2wpkh: 'ecdsa',
  'p2sh-p2wpkh': 'ecdsa',
  p2wsh: 'ecdsa',
  p2tr: 'schnorr',
}
