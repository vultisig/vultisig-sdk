import { create } from '@bufbuild/protobuf'
import { getPolkadotClient } from '@vultisig/core-chain/chains/polkadot/client'
import { polkadotConfig } from '@vultisig/core-chain/chains/polkadot/config'
import { PolkadotSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { attempt, withFallback } from '@vultisig/lib-utils/attempt'

import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'
import { refinePolkadotChainSpecific } from './refine'

export const getPolkadotChainSpecific: GetChainSpecificResolver<'polkadotSpecific'> = async ({
  keysignPayload,
  walletCore,
}) => {
  const client = await getPolkadotClient()

  const { address } = getKeysignCoin(keysignPayload)

  // Fetch the header ONCE and derive both the era checkpoint block number
  // and its block hash from the same response. Doing them as two separate
  // RPC calls (getBlockHash + getHeader) lets the chain head advance
  // between the two — the era then encodes phase = (N+1) % period while
  // `additional_signed.blockHash` still holds the hash of block N. The
  // runtime recomputes the checkpoint at validation, finds the wrong hash,
  // and rejects with InvalidTransaction::BadProof; substrate then bans the
  // extrinsic hash so every retry comes back as "Transaction is
  // temporarily banned". On Asset Hub this race fires often enough to be
  // user-visible.
  const [{ specVersion, transactionVersion }, header, nextIndex, genesisHash] = await Promise.all([
    client.rpc.state.getRuntimeVersion(),
    client.rpc.chain.getHeader(),
    client.rpc.system.accountNextIndex(address),
    client.rpc.chain.getBlockHash(0),
  ])

  const chainSpecific = create(PolkadotSpecificSchema, {
    recentBlockHash: header.hash.toHex(),
    nonce: nextIndex.toBigInt(),
    currentBlockNumber: header.number.toString(),
    specVersion: specVersion.toNumber(),
    transactionVersion: transactionVersion.toNumber(),
    genesisHash: genesisHash.toHex(),
    gas: polkadotConfig.fee,
  })

  return withFallback(
    attempt(
      refinePolkadotChainSpecific({
        keysignPayload,
        chainSpecific,
        walletCore,
      })
    ),
    chainSpecific
  )
}
