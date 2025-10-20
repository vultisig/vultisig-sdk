import { OtherChain } from '../../../Chain'
import { TxHashResolver } from '../resolver'

// Now that we have dynamic imports at the index level,
// this module will only be loaded when actually needed for Cardano
export const getCardanoTxHash: TxHashResolver<OtherChain.Cardano> = async ({
  encoded,
}) => {
  // Still use dynamic import for the Cardano SDK to handle missing dependency gracefully
  const { Serialization } = await import('@cardano-sdk/core' as any).catch(() => {
    throw new Error('Cardano SDK not available. Please install @cardano-sdk/core to use Cardano features.')
  })

  return Serialization.Transaction.fromCbor(
    Serialization.TxCBOR(Buffer.from(encoded).toString('hex'))
  ).getId()
}
