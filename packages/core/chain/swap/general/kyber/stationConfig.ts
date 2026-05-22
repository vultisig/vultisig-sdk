import { Minutes } from '@vultisig/lib-utils/time'

export const stationKyberSwapAffiliateConfig = {
  // Station source ID pending Kyber partner-team confirmation.
  // Using vultisig-v0 as a temp fallback per spec — fees still flow to
  // Station's feeReceiver correctly; only Kyber's attribution dashboard
  // is mis-tagged until the new source ID is registered.
  source: 'vultisig-v0',
  referral: '0x649E1289fD780C2F9A3D27476511283EB0d0076D',
}
