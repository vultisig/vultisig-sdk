import { Cell, loadMessage } from '@ton/core'
import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { Buffer } from 'buffer'

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

type TonFeeValue = number | string

type TonFees = {
  in_fwd_fee: TonFeeValue
  storage_fee: TonFeeValue
  gas_fee: TonFeeValue
  fwd_fee: TonFeeValue
}

type TonEstimateFeeResponse = {
  ok: boolean
  result?: {
    source_fees: TonFees
    destination_fees?: TonFees[]
  }
  error?: string
}

const sumTonFees = ({ in_fwd_fee, storage_fee, gas_fee, fwd_fee }: TonFees): bigint =>
  [in_fwd_fee, storage_fee, gas_fee, fwd_fee].reduce((total, fee) => {
    const value = BigInt(fee)
    if (value < 0n) {
      throw new Error(`toncenter estimateFee returned a negative fee: ${value}`)
    }
    return total + value
  }, 0n)

/**
 * Dry-runs a compiled TON external message through toncenter's v2
 * `estimateFee` endpoint. The endpoint expects the external message body (and
 * separate StateInit cells for a first outgoing transaction), not the full
 * broadcast BoC, so extract those cells before making the request.
 */
export const estimateTonFee = async ({
  address,
  externalMessageBoc,
}: {
  address: string
  externalMessageBoc: string
}): Promise<bigint> => {
  const [root] = Cell.fromBoc(Buffer.from(externalMessageBoc, 'base64'))
  if (!root) {
    throw new Error('TON fee estimate external message BoC is empty')
  }

  const message = loadMessage(root.beginParse())
  if (message.info.type !== 'external-in') {
    throw new Error(`TON fee estimate requires an external-in message, got ${message.info.type}`)
  }

  const response = await queryUrl<TonEstimateFeeResponse>(`${tonApiUrl}/v2/estimateFee`, {
    body: {
      address,
      body: message.body.toBoc().toString('base64'),
      init_code: message.init?.code?.toBoc().toString('base64'),
      init_data: message.init?.data?.toBoc().toString('base64'),
      ignore_chksig: true,
    },
  })

  if (!response.ok || !response.result) {
    throw new Error(`toncenter estimateFee failed: ${response.error ?? 'missing result'}`)
  }

  const total = [response.result.source_fees, ...(response.result.destination_fees ?? [])].reduce(
    (sum, fees) => sum + sumTonFees(fees),
    0n
  )
  if (total <= 0n) {
    throw new Error(`toncenter estimateFee returned a non-positive total: ${total}`)
  }

  return total
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
