import { CoinKey } from '../Coin'

export const isFeeCoin = (coin: CoinKey) => !coin.id
