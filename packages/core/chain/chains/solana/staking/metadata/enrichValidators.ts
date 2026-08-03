import { SolanaValidator } from '../models/validator'
import { stakewizValidatorMetadataProvider } from './stakewizProvider'
import { ValidatorMetadataProvider } from './ValidatorMetadataProvider'

/**
 * Merges off-chain metadata (name / logo / APY) onto on-chain validator rows
 * via the swappable provider. The provider never throws — on an outage the rows
 * pass through with empty metadata and the display layer falls back to a
 * truncated vote pubkey + on-chain commission.
 *
 * Replaces the call site where iOS's view models invoke the
 * `ValidatorMetadataProvider`; the provider is injectable for tests.
 */
export const enrichValidatorsWithMetadata = async (
  validators: SolanaValidator[],
  provider: ValidatorMetadataProvider = stakewizValidatorMetadataProvider
): Promise<SolanaValidator[]> => {
  const metadataByVotePubkey = await provider.metadata(validators.map(v => v.votePubkey))
  return validators.map(validator => {
    const metadata = metadataByVotePubkey[validator.votePubkey]
    return metadata ? { ...validator, metadata } : validator
  })
}
