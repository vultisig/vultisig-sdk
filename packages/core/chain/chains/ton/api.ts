import { rootApiUrl } from '@vultisig/core-config'
import { toBatches } from '@vultisig/lib-utils/array/toBatches'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tonAddressToRaw, tonAddressToRawKey } from './address'

const tonApiUrl = `${rootApiUrl}/ton`

type JettonWallet = {
  address: string
  owner: string
  jetton: string
  balance: string
}

type AddressBook = Record<
  string,
  {
    user_friendly: string
  }
>

type JettonTokenInfo = {
  valid?: boolean
  type?: string
  name?: string
  symbol?: string
  description?: string
  image?: string
  is_scam?: boolean
  extra?: {
    decimals?: string
    uri?: string
    _image_small?: string
    _image_medium?: string
    _image_big?: string
  }
}

type IndexerMetadata = Record<
  string,
  {
    is_indexed?: boolean
    token_info?: JettonTokenInfo[]
  }
>

type JettonWalletResponse = {
  jetton_wallets: JettonWallet[]
  address_book: AddressBook
  metadata?: IndexerMetadata
}

type GetJettonWalletInput = {
  ownerAddress: string
  jettonMasterAddress: string
}

const matchesRawAddress = (value: string, expected: string): boolean => value.toLowerCase() === expected.toLowerCase()

/**
 * Queries the Vultisig proxy (pass-through to toncenter v3) for the jetton wallet
 * matching a given owner + jetton master.
 *
 * toncenter filters on `owner_address` + `jetton_address`. We additionally filter
 * the response client-side: if the proxy ever ignores those params it returns an
 * unfiltered global list, and blindly taking the first entry would surface a
 * stranger's balance (e.g. a whale's 200M USDT instead of the user's 0).
 */
const queryOwnerJettonWallet = async ({
  ownerAddress,
  jettonMasterAddress,
}: GetJettonWalletInput): Promise<{
  wallet?: JettonWallet
  addressBook: JettonWalletResponse['address_book']
}> => {
  const rawOwner = tonAddressToRaw(ownerAddress)
  const rawMaster = tonAddressToRaw(jettonMasterAddress)

  const url = `${tonApiUrl}/v3/jetton/wallets?owner_address=${rawOwner}&jetton_address=${rawMaster}`
  const response = await queryUrl<JettonWalletResponse>(url)

  const wallet = response.jetton_wallets.find(
    ({ owner, jetton }) => matchesRawAddress(owner, rawOwner) && matchesRawAddress(jetton, rawMaster)
  )

  return { wallet, addressBook: response.address_book }
}

/** Resolves the user-friendly jetton wallet address for a given owner and jetton master. */
export const getJettonWalletAddress = async (input: GetJettonWalletInput): Promise<string> => {
  const { wallet, addressBook } = await queryOwnerJettonWallet(input)
  if (!wallet) {
    throw new Error('No jetton wallet found')
  }

  return addressBook[wallet.address]?.user_friendly || wallet.address
}

/** Fetches the balance of a specific jetton for a given owner address. */
export const getJettonBalance = async (input: GetJettonWalletInput): Promise<bigint> => {
  const { wallet } = await queryOwnerJettonWallet(input)

  return BigInt(wallet?.balance || '0')
}

type AddressInformationResponse = {
  balance: string
  status: string
}

export const getTonWalletState = async (address: string): Promise<string> => {
  const url = `${tonApiUrl}/v3/addressInformation?address=${address}&use_v2=false`
  const response = await queryUrl<AddressInformationResponse>(url)

  return response.status
}

type JettonContent = {
  decimals?: string
  uri?: string
  name?: string
  symbol?: string
  image?: string
}

type JettonMasterEntry = {
  address: string
  total_supply?: string
  mintable?: boolean
  jetton_content?: JettonContent
}

type JettonMastersResponse = {
  jetton_masters: JettonMasterEntry[]
  address_book?: AddressBook
  metadata?: IndexerMetadata
}

/**
 * Display metadata Toncenter holds for a jetton master, without any of the
 * fields being guaranteed: an unindexed or broken jetton can lack all of them.
 */
export type JettonMasterMetadata = {
  /** Raw `workchain:hex` address, lower-cased (see `tonAddressToRawKey`). */
  address: string
  symbol?: string
  name?: string
  decimals?: number
  logo?: string
  /** `true` when Toncenter's indexer has flagged the jetton as a scam. */
  isFlaggedScam?: boolean
}

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const parseDecimals = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined

  const parsed = parseInt(value, 10)

  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Picks the indexer's validated `jetton_masters` entry for an address, if the
 * response carries one. Wallet listings also embed entries of type
 * `jetton_wallets` under the wallet addresses, which are not what we want.
 */
const getIndexedMasterInfo = (metadata: IndexerMetadata | undefined, address: string): JettonTokenInfo | undefined =>
  metadata?.[address]?.token_info?.find(
    entry => entry.valid === true && (entry.type === undefined || entry.type === 'jetton_masters')
  )

type ParseJettonMasterMetadataInput = {
  address: string
  indexed?: JettonTokenInfo
  content?: JettonContent
}

/**
 * Merges Toncenter's validated indexer entry with the on-chain TEP-64 content,
 * preferring the indexer. Prefers Toncenter's imgproxy URLs for the logo: the
 * original `image` URL often serves with `Cross-Origin-Resource-Policy:
 * same-origin`, which browsers refuse to embed cross-origin, while the
 * `_image_*` variants are normalized PNGs that load reliably in extension and
 * desktop pages.
 */
const parseJettonMasterMetadata = ({
  address,
  indexed,
  content,
}: ParseJettonMasterMetadataInput): JettonMasterMetadata => {
  const logo =
    nonEmpty(indexed?.extra?._image_medium) ??
    nonEmpty(indexed?.extra?._image_small) ??
    nonEmpty(indexed?.extra?._image_big) ??
    nonEmpty(indexed?.image) ??
    nonEmpty(content?.image)

  return {
    address: tonAddressToRawKey(address),
    symbol: nonEmpty(indexed?.symbol) ?? nonEmpty(content?.symbol),
    name: nonEmpty(indexed?.name) ?? nonEmpty(content?.name),
    decimals: parseDecimals(indexed?.extra?.decimals ?? content?.decimals),
    logo,
    ...(indexed?.is_scam === undefined ? {} : { isFlaggedScam: indexed.is_scam }),
  }
}

export type JettonMasterInfo = {
  ticker: string
  decimals: number
  logo?: string
}

/**
 * Fetches jetton master metadata (ticker, decimals, logo) from toncenter v3.
 * Prefers Toncenter's validated indexer entry (`token_info` with `valid: true`),
 * falling back to the on-chain TEP-64 `jetton_content` stored in the master.
 * Throws when the jetton is unknown or has no symbol; decimals default to 9.
 */
export const getJettonMasterInfo = async (jettonMasterAddress: string): Promise<JettonMasterInfo> => {
  const url = `${tonApiUrl}/v3/jetton/masters?address=${encodeURIComponent(jettonMasterAddress)}&limit=1`
  const response = await queryUrl<JettonMastersResponse>(url)

  const master = response.jetton_masters[0]
  if (!master) {
    throw new Error(`No jetton master found for ${jettonMasterAddress}`)
  }

  const { symbol, decimals, logo } = parseJettonMasterMetadata({
    address: master.address,
    indexed: getIndexedMasterInfo(response.metadata, master.address),
    content: master.jetton_content,
  })

  if (!symbol) {
    throw new Error(`Jetton master ${jettonMasterAddress} has no symbol`)
  }

  return { ticker: symbol, decimals: decimals ?? 9, logo }
}

// Toncenter accepts a comma-separated address list; each raw address is ~67
// chars, so 50 keeps the query string comfortably under gateway URI limits.
const jettonMastersPerRequest = 50

/**
 * Fetches metadata for many jetton masters at once, keyed by lower-cased raw
 * address. Masters Toncenter does not know are simply absent from the result;
 * nothing throws for a missing symbol, unlike `getJettonMasterInfo`.
 */
export const getJettonMastersMetadata = async (
  jettonMasterAddresses: string[]
): Promise<Record<string, JettonMasterMetadata>> => {
  const rawAddresses = [...new Set(jettonMasterAddresses.map(tonAddressToRawKey))]
  const result: Record<string, JettonMasterMetadata> = {}

  for (const batch of toBatches(rawAddresses, jettonMastersPerRequest)) {
    const url = `${tonApiUrl}/v3/jetton/masters?address=${batch.join(',')}&limit=${batch.length}`
    const response = await queryUrl<JettonMastersResponse>(url)

    for (const master of response.jetton_masters) {
      const metadata = parseJettonMasterMetadata({
        address: master.address,
        indexed: getIndexedMasterInfo(response.metadata, master.address),
        content: master.jetton_content,
      })
      result[metadata.address] = metadata
    }
  }

  return result
}

export type OwnerJettonWallet = {
  /** Jetton master address as a lower-cased raw key. */
  jettonMasterAddress: string
  balance: bigint
}

export type OwnerJettonWallets = {
  wallets: OwnerJettonWallet[]
  /** Indexer metadata for the masters behind `wallets`, keyed like `jettonMasterAddress`. */
  masters: Record<string, JettonMasterMetadata>
  /** User-friendly spellings Toncenter returned for master addresses, keyed like `jettonMasterAddress`. */
  userFriendlyAddresses: Record<string, string>
}

const ownerJettonWalletsPageSize = 100

// 2000 distinct jettons is far beyond any real wallet; the cap only guards
// against a proxy that ignores `offset` and keeps returning the first page.
const ownerJettonWalletsMaxPages = 20

/**
 * Lists every jetton the owner holds a non-zero balance of, with the master
 * metadata Toncenter embeds in the same response, so discovery needs no
 * follow-up call per jetton. Pages through the proxy and keeps only wallets
 * whose `owner` is the requested address (the proxy has been seen to return
 * unfiltered lists).
 */
export const getOwnerJettonWallets = async (ownerAddress: string): Promise<OwnerJettonWallets> => {
  const rawOwner = tonAddressToRaw(ownerAddress)
  const wallets: OwnerJettonWallet[] = []
  const masters: Record<string, JettonMasterMetadata> = {}
  const userFriendlyAddresses: Record<string, string> = {}

  for (let page = 0; page < ownerJettonWalletsMaxPages; page++) {
    const offset = page * ownerJettonWalletsPageSize
    const url = `${tonApiUrl}/v3/jetton/wallets?owner_address=${rawOwner}&exclude_zero_balance=true&limit=${ownerJettonWalletsPageSize}&offset=${offset}`
    const response = await queryUrl<JettonWalletResponse>(url)

    for (const wallet of response.jetton_wallets) {
      if (!matchesRawAddress(wallet.owner, rawOwner)) continue

      const jettonMasterAddress = tonAddressToRawKey(wallet.jetton)
      wallets.push({ jettonMasterAddress, balance: BigInt(wallet.balance || '0') })

      const indexed = getIndexedMasterInfo(response.metadata, wallet.jetton)
      if (indexed) {
        masters[jettonMasterAddress] = parseJettonMasterMetadata({ address: wallet.jetton, indexed })
      }

      const userFriendly = response.address_book?.[wallet.jetton]?.user_friendly
      if (userFriendly) {
        userFriendlyAddresses[jettonMasterAddress] = userFriendly
      }
    }

    if (response.jetton_wallets.length < ownerJettonWalletsPageSize) break
  }

  return { wallets, masters, userFriendlyAddresses }
}
