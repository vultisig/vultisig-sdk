import { signingAlgorithms } from '@vultisig/core-chain/signing/SignatureAlgorithm'

export type PublicKeys = Record<
  (typeof signingAlgorithms)[number],
  string
>
