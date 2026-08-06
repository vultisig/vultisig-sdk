import type { SuiClient } from './client'

/**
 * A coin object flattened into the shape the keysign payload stores.
 *
 * The unified client returns coin objects whose `type` is the full wrapper
 * (`0x2::coin::Coin<0x2::sui::SUI>`) and whose id field is `objectId`; the
 * retired JSON-RPC `CoinStruct` exposed the inner `coinType` and
 * `coinObjectId` directly. Normalizing here keeps coin selection, the
 * `SuiCoin` protobuf and every downstream comparison unchanged.
 */
export type SuiCoinObject = {
  coinType: string
  coinObjectId: string
  version: string
  digest: string
  balance: string
}

/**
 * A misbehaving endpoint that keeps returning `hasNextPage: true` with a
 * non-advancing cursor would otherwise spin forever. 200 pages is far beyond
 * any real wallet, so hitting the cap means the cursor is stuck: fail CLOSED
 * rather than hang or silently truncate the coin set and under-fund a send.
 */
export const maxSuiCoinPages = 200

const coinWrapperType = /::coin::Coin<(.+)>$/

/** `0x2::coin::Coin<0x2::sui::SUI>` -> `0x2::sui::SUI`. */
export const unwrapSuiCoinType = (objectType: string | undefined, fallback: string): string =>
  objectType?.match(coinWrapperType)?.[1] ?? fallback

type ListAllSuiCoinsInput = {
  client: Pick<SuiClient, 'listCoins'>
  owner: string
  coinType: string
}

/**
 * Every coin object of one coin type owned by `owner`.
 *
 * `listCoins` is paginated (~50 objects/page). Sui's object-per-coin model
 * makes >50 coin objects realistic for an active wallet (dust, partial fills,
 * repeated small transfers, staking rewards), so reading only the first page
 * silently truncates the coin set and produces a broken send ("insufficient
 * balance" despite adequate holdings) even though the balance-based display
 * path shows the correct aggregate total. Follow the cursor to completion.
 */
export const listAllSuiCoins = async ({ client, owner, coinType }: ListAllSuiCoinsInput): Promise<SuiCoinObject[]> => {
  const coins: SuiCoinObject[] = []
  let cursor: string | null | undefined = undefined
  let pages = 0

  do {
    const page = await client.listCoins({ owner, coinType, cursor })

    for (const object of page.objects) {
      coins.push({
        coinType: unwrapSuiCoinType(object.type, coinType),
        coinObjectId: object.objectId,
        version: object.version,
        digest: object.digest,
        balance: object.balance,
      })
    }

    cursor = page.hasNextPage ? page.cursor : null

    if (++pages >= maxSuiCoinPages && cursor) {
      throw new Error(
        `listAllSuiCoins: exceeded ${maxSuiCoinPages} pages for ${owner} (${coinType}) — refusing to build a send from a possibly-truncated or looping coin set`
      )
    }
  } while (cursor)

  return coins
}
