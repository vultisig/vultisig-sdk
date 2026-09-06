import type { TxStatusResult } from '@vultisig/sdk'

export type TxStatusEvent = 'vault:transactionConfirmed' | 'vault:transactionFailed'

export const getTxStatusEvent = (status: TxStatusResult['status']): TxStatusEvent | undefined => {
  if (status === 'success') return 'vault:transactionConfirmed'
  if (status === 'error' || status === 'expired') return 'vault:transactionFailed'

  return undefined
}
