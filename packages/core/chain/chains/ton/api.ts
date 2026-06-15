import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tonAddressToRaw } from './address'

const tonApiUrl = `${rootApiUrl}/ton`

type JettonWallet = {
  address: string
  owner: string
  jetton: string
  balance: string
}

type JettonWalletResponse = {
  jetton_wallets: JettonWallet[]
  address_book: Record<
    string,
    {
      user_friendly: string
    }
  >
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

type JettonTokenInfo = {
  valid?: boolean
  type?: string
  name?: string
  symbol?: string
  description?: string
  image?: string
  extra?: {
    decimals?: string
    uri?: string
    _image_small?: string
    _image_medium?: string
    _image_big?: string
  }
}

type JettonMasterEntry = {
  address: string
  total_supply?: string
  mintable?: boolean
  jetton_content?: JettonContent
}

type JettonMastersResponse = {
  jetton_masters: JettonMasterEntry[]
  metadata?: Record<
    string,
    {
      is_indexed?: boolean
      token_info?: JettonTokenInfo[]
    }
  >
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
 */
export const getJettonMasterInfo = async (jettonMasterAddress: string): Promise<JettonMasterInfo> => {
  const url = `${tonApiUrl}/v3/jetton/masters?address=${encodeURIComponent(jettonMasterAddress)}&limit=1`
  const response = await queryUrl<JettonMastersResponse>(url)

  const master = response.jetton_masters[0]
  if (!master) {
    throw new Error(`No jetton master found for ${jettonMasterAddress}`)
  }

  const nonEmpty = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
  }

  const indexed = response.metadata?.[master.address]?.token_info?.find(entry => entry.valid === true)
  const content = master.jetton_content

  const ticker = nonEmpty(indexed?.symbol) ?? nonEmpty(content?.symbol)
  if (!ticker) {
    throw new Error(`Jetton master ${jettonMasterAddress} has no symbol`)
  }

  const decimalsRaw = indexed?.extra?.decimals ?? content?.decimals
  const parsedDecimals = decimalsRaw !== undefined ? parseInt(decimalsRaw, 10) : NaN
  const decimals = Number.isFinite(parsedDecimals) ? parsedDecimals : 9

  // Prefer Toncenter's imgproxy URLs: the original `image` URL often serves
  // with `Cross-Origin-Resource-Policy: same-origin`, which browsers refuse
  // to embed cross-origin. The `_image_*` variants are normalized PNGs from
  // `imgproxy.toncenter.com` and load reliably in extension/desktop pages.
  const logo =
    nonEmpty(indexed?.extra?._image_medium) ??
    nonEmpty(indexed?.extra?._image_small) ??
    nonEmpty(indexed?.extra?._image_big) ??
    nonEmpty(indexed?.image) ??
    nonEmpty(content?.image)

  return { ticker, decimals, logo }
}
