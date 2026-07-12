import { create } from '@bufbuild/protobuf'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { suiGasBudget } from '@vultisig/core-chain/chains/sui/config'
import { SuiCoinSchema, SuiSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { attempt, withFallback } from '@vultisig/lib-utils/attempt'
import type { CoinStruct } from '@mysten/sui/jsonRpc'

import { selectSuiPayloadCoins } from '../../../../chains/sui/coinSelection'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'
import { refineSuiChainSpecific } from './refine'

export const getSuiChainSpecific: GetChainSpecificResolver<'suicheSpecific'> = async ({
  keysignPayload,
  walletCore,
}) => {
  // dApp-supplied PTBs (`signData.signSui`) are already fully built: coins,
  // gas budget and reference gas price are baked into the BCS bytes that
  // `getSuiSigningInputs` forwards verbatim. There are no construction inputs
  // to fetch, so return an empty SuiSpecific instead of hitting the RPC.
  if (keysignPayload.signData.case === 'signSui') {
    return create(SuiSpecificSchema, {})
  }

  const coin = getKeysignCoin(keysignPayload)
  const { address } = coin
  const client = getSuiClient()

  // `getAllCoins` is paginated (~50 objects/page). Sui's object-per-coin model
  // makes >50 coin objects realistic for an active wallet (dust, partial fills,
  // repeated small transfers, staking rewards), so reading only the first page
  // silently truncates the coin set. That set feeds both `gasCoins` (native SUI
  // objects for the Pay/PaySui gas payment) and `inputCoins` (the coinType being
  // sent) downstream, so a truncated page produces a broken send ("insufficient
  // balance" despite adequate holdings, or an empty inputCoins array if none of
  // the sent coinType's objects land on page 1) even though the getBalance-based
  // display path shows the correct aggregate total. Follow the cursor to
  // completion, mirroring the Solana SPL pagination fix (sdk#962).
  // Bound the cursor loop: a buggy/misbehaving RPC that keeps returning
  // hasNextPage=true with a non-advancing cursor would otherwise spin forever.
  // 200 pages ≈ 10k coin objects — far beyond any real wallet — so hitting the
  // cap means the cursor is stuck; fail CLOSED (throw) rather than hang or
  // silently truncate the coin set and under-fund the send.
  const MAX_COIN_PAGES = 200
  const rawCoins: CoinStruct[] = []
  let cursor: string | null | undefined = undefined
  let pages = 0
  do {
    const page = await client.getAllCoins({ owner: address, cursor })
    rawCoins.push(...page.data)
    cursor = page.hasNextPage ? page.nextCursor : null
    if (++pages >= MAX_COIN_PAGES && cursor) {
      throw new Error(
        `getSuiChainSpecific: getAllCoins exceeded ${MAX_COIN_PAGES} pages for ${address} — refusing to build a send from a possibly-truncated or looping coin set`
      )
    }
  } while (cursor)

  // Bound the embedded coin set to what the send actually needs (sdk#1132,
  // iOS #4734 parity): embedding every owned object makes a dusty wallet's
  // keysign payload too large to relay (co-signer poll 404 / "data expired")
  // and drags unrelated coin types (memecoins/LSTs) into the payload. The
  // signing-input resolver performs the same deterministic selection on this
  // set, so the bounded output is exactly the inputs the signer consumes —
  // plus, for a token send, the largest few native objects as gas candidates
  // so a covering gas object survives the refine step's re-estimated budget.
  const coins = selectSuiPayloadCoins({
    coins: rawCoins.map((coin: CoinStruct) => create(SuiCoinSchema, coin)),
    contractAddress: coin.id ?? '',
    amount: BigInt(keysignPayload.toAmount || '0'),
    gasBudget: suiGasBudget,
  })

  const referenceGasPrice = await client.getReferenceGasPrice()

  const chainSpecific = create(SuiSpecificSchema, {
    coins,
    referenceGasPrice: referenceGasPrice.toString(),
    gasBudget: suiGasBudget.toString(),
  })

  return withFallback(
    attempt(
      refineSuiChainSpecific({
        keysignPayload,
        chainSpecific,
        walletCore,
      })
    ),
    chainSpecific
  )
}
