import { CoinKey } from '@vultisig/core-chain/coin/Coin'

export const isFeeCoin = (coin: CoinKey) => !coin.id
