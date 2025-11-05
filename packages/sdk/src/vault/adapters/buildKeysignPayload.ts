import { Chain } from '@core/chain/Chain'
import { AccountCoin } from '@core/chain/coin/AccountCoin'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { getPreSigningHashes } from '@core/chain/tx/preSigningHashes'
// import { buildSendKeysignPayload } from '@core/mpc/keysign/build/send'
import { getEncodedSigningInputs } from '@core/mpc/keysign/signingInputs'
import { WalletCore } from '@trustwallet/wallet-core'
import { Vault, SigningPayload } from '../../types'

/**
 * Build keysign payload for MPC signing using core functions
 *
 * This function:
 * 1. Builds a complete KeysignPayload using core's buildSendKeysignPayload
 * 2. Gets encoded signing inputs (protobuf)
 * 3. Computes pre-signing hashes
 * 4. Returns hex-encoded message hashes ready for MPC signing
 *
 * @param sdkPayload Signing payload from SDK with transaction details
 * @param chain Chain value (e.g., 'Ethereum', 'Bitcoin')
 * @param walletCore WalletCore WASM instance
 * @param vaultData Vault data with keys and signers
 * @returns Array of hex-encoded message hashes to sign
 */
export async function buildKeysignPayload(
  sdkPayload: SigningPayload,
  chain: Chain,
  walletCore: WalletCore,
  vaultData: Vault
): Promise<string[]> {
  const { transaction } = sdkPayload

  // Extract transaction details
  const receiver = transaction.receiver || transaction.toAddress
  const amount = BigInt(transaction.amount || transaction.toAmount || '0')
  const memo = transaction.memo

  if (!receiver) {
    throw new Error('Transaction receiver address is required')
  }

  // Build AccountCoin for the chain
  const coin: AccountCoin = {
    chain,
    address: '', // Will be set by buildSendKeysignPayload
    decimals: chainFeeCoin[chain].decimals,
    ticker: chainFeeCoin[chain].ticker,
  }

  // Get public key for this chain (returns WalletCore PublicKey object)
  const publicKey = getPublicKey({
    chain,
    walletCore,
    hexChainCode: vaultData.hexChainCode,
    publicKeys: vaultData.publicKeys,
  })

  // Build the complete keysign payload using core function
  const keysignPayload = await buildSendKeysignPayload({
    coin,
    receiver,
    amount,
    memo,
    vaultId: vaultData.publicKeys.ecdsa,
    localPartyId: vaultData.localPartyId,
    publicKey,
    walletCore,
    libType: vaultData.libType,
  })

  // Get encoded signing inputs from the keysign payload
  const signingInputs = getEncodedSigningInputs({
    keysignPayload,
    walletCore,
    publicKey,
  })

  // Get pre-signing hashes from the signing inputs
  const messageHashes = signingInputs.flatMap(txInputData => {
    const hashes = getPreSigningHashes({
      walletCore,
      chain,
      txInputData,
    })
    return hashes.map(hash => Buffer.from(hash).toString('hex'))
  })

  return messageHashes
}
