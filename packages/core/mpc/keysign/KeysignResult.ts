import { Tx } from '@vultisig/core-chain/tx'

export type KeysignResult = { txs: Tx[] } | { signature: string }
