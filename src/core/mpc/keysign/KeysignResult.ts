import { Tx } from '../../chain/tx'

export type KeysignResult = { txs: Tx[] } | { signature: string }
