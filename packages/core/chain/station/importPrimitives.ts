import type { WalletCore } from '@trustwallet/wallet-core'
import BIP32Factory from 'bip32'
import * as ecc from 'tiny-secp256k1'

import { Chain } from '../Chain'
import { deriveAddress } from '../publicKey/address/deriveAddress'

export const stationTerraCoinTypes = [330, 118] as const

export type StationTerraCoinType = (typeof stationTerraCoinTypes)[number]
export type StationTerraChain = typeof Chain.Terra | typeof Chain.TerraClassic

type StationTerraDerivationOptions = {
  /** Station account index from the legacy wallet. Defaults to 0. */
  index?: number
  /** BIP44 account segment. Station uses 0 by default. */
  account?: number
  /** Terra coin type. Station defaults to 330 and legacy wallets may use 118. */
  coinType?: StationTerraCoinType
}

export type StationSeedImportSource = StationTerraDerivationOptions & {
  kind: 'seed'
  /** BIP39 seed bytes, for example legacy Station encryptedSeed after decrypting. */
  seed: Uint8Array
}

export type StationMnemonicImportSource = StationTerraDerivationOptions & {
  kind: 'mnemonic'
  mnemonic: string
}

export type StationPrivateKeyImportSource = {
  kind: 'privateKey'
  /** Raw secp256k1 private key as 64 hex characters, optionally prefixed with 0x. */
  privateKeyHex: string
}

export type StationImportSource = StationSeedImportSource | StationMnemonicImportSource | StationPrivateKeyImportSource

export type StationTerraChainPublicData = {
  chain: StationTerraChain
  publicKeyHex: string
  publicKeyBase64: string
  address: string
  isEddsa: false
}

export type StationTerraKeyMaterial = {
  source: StationImportSource['kind']
  privateKeyHex: string
  publicKeyHex: string
  publicKeyBase64: string
  address: string
  chainPublicKeys: StationTerraChainPublicData[]
  derivePath?: string
  coinType?: StationTerraCoinType
  account?: number
  index?: number
}

type DeriveStationTerraKeyMaterialInput = {
  source: StationImportSource
  walletCore: WalletCore
}

const stationTerraChains = [Chain.Terra, Chain.TerraClassic] as const

const assertNonNegativeInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
}

const normalizeDerivationOptions = ({
  account = 0,
  index = 0,
  coinType = 330,
}: StationTerraDerivationOptions): Required<StationTerraDerivationOptions> => {
  assertNonNegativeInteger(account, 'account')
  assertNonNegativeInteger(index, 'index')

  if (!stationTerraCoinTypes.includes(coinType)) {
    throw new Error(`Unsupported Station Terra coin type: ${coinType}`)
  }

  return { account, index, coinType }
}

export const getStationTerraDerivationPath = (options: StationTerraDerivationOptions = {}): string => {
  const { account, index, coinType } = normalizeDerivationOptions(options)

  return `m/44'/${coinType}'/${account}'/0/${index}`
}

export const normalizeStationPrivateKeyHex = (input: string): string =>
  input.trim().replace(/^0x/i, '').replace(/\s+/g, '').toLowerCase()

export const validateStationPrivateKeyHex = (input: string): string => {
  const privateKeyHex = normalizeStationPrivateKeyHex(input)

  if (!/^[0-9a-f]{64}$/.test(privateKeyHex)) {
    throw new Error('Private key must be 64 hexadecimal characters')
  }

  if (!ecc.isPrivate(Buffer.from(privateKeyHex, 'hex'))) {
    throw new Error('Invalid secp256k1 private key')
  }

  return privateKeyHex
}

const derivePrivateKeyHexFromSeed = (source: StationSeedImportSource): StationTerraKeyMaterialSeedFields => {
  const { account, index, coinType } = normalizeDerivationOptions(source)
  const bip32 = BIP32Factory(ecc)
  const derived = bip32
    .fromSeed(Buffer.from(source.seed))
    .derivePath(getStationTerraDerivationPath({ account, index, coinType }))
  const privateKey = derived.privateKey

  if (!privateKey) {
    throw new Error('Failed to derive Station Terra private key from seed')
  }

  return {
    privateKeyHex: Buffer.from(privateKey).toString('hex'),
    derivePath: getStationTerraDerivationPath({ account, index, coinType }),
    account,
    index,
    coinType,
  }
}

type StationTerraKeyMaterialSeedFields = Pick<
  StationTerraKeyMaterial,
  'privateKeyHex' | 'derivePath' | 'account' | 'index' | 'coinType'
>

const walletCoreCoinTypeForStationTerra = (walletCore: WalletCore, coinType: StationTerraCoinType) =>
  coinType === 330 ? walletCore.CoinType.terraV2 : walletCore.CoinType.terra

const derivePrivateKeyHexFromMnemonic = (
  source: StationMnemonicImportSource,
  walletCore: WalletCore
): StationTerraKeyMaterialSeedFields => {
  const { account, index, coinType } = normalizeDerivationOptions(source)
  const derivePath = getStationTerraDerivationPath({ account, index, coinType })
  const hdWallet = walletCore.HDWallet.createWithMnemonic(source.mnemonic.trim(), '')

  try {
    const privateKey = hdWallet.getKey(walletCoreCoinTypeForStationTerra(walletCore, coinType), derivePath)

    try {
      return {
        privateKeyHex: Buffer.from(privateKey.data()).toString('hex'),
        derivePath,
        account,
        index,
        coinType,
      }
    } finally {
      privateKey.delete?.()
    }
  } finally {
    hdWallet.delete?.()
  }
}

const derivePublicDataFromPrivateKey = (privateKeyHex: string, walletCore: WalletCore) => {
  const normalizedPrivateKeyHex = validateStationPrivateKeyHex(privateKeyHex)
  const privateKey = walletCore.PrivateKey.createWithData(Buffer.from(normalizedPrivateKeyHex, 'hex'))

  try {
    const publicKey = privateKey.getPublicKeySecp256k1(true)

    try {
      const publicKeyHex = Buffer.from(publicKey.data()).toString('hex')
      const publicKeyBase64 = Buffer.from(publicKey.data()).toString('base64')
      const chainPublicKeys = stationTerraChains.map(chain => ({
        chain,
        publicKeyHex,
        publicKeyBase64,
        address: deriveAddress({ chain, publicKey, walletCore }),
        isEddsa: false as const,
      }))

      return {
        privateKeyHex: normalizedPrivateKeyHex,
        publicKeyHex,
        publicKeyBase64,
        address: chainPublicKeys[0].address,
        chainPublicKeys,
      }
    } finally {
      publicKey.delete?.()
    }
  } finally {
    privateKey.delete?.()
  }
}

export const deriveStationTerraKeyMaterial = ({
  source,
  walletCore,
}: DeriveStationTerraKeyMaterialInput): StationTerraKeyMaterial => {
  if (source.kind === 'privateKey') {
    return {
      source: source.kind,
      ...derivePublicDataFromPrivateKey(source.privateKeyHex, walletCore),
    }
  }

  const seedFields =
    source.kind === 'mnemonic'
      ? derivePrivateKeyHexFromMnemonic(source, walletCore)
      : derivePrivateKeyHexFromSeed(source)

  return {
    source: source.kind,
    ...seedFields,
    ...derivePublicDataFromPrivateKey(seedFields.privateKeyHex, walletCore),
  }
}
