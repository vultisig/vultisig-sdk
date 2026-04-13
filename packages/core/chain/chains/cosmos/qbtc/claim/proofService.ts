/** Base URL for the QBTC proof service. */
export const defaultProofServiceUrl = 'https://proof.qbtc.network'

const proofGenerationTimeoutMs = 300_000

type ProofServiceHealthResponse = {
  status: string
  setup_loaded: boolean
}

/** Checks whether the proof service is healthy and ready. */
export const checkProofServiceHealth = async ({
  baseUrl = defaultProofServiceUrl,
}: { baseUrl?: string } = {}): Promise<boolean> => {
  try {
    const response = await fetch(`${baseUrl}/health`)
    if (!response.ok) return false
    const data: ProofServiceHealthResponse = await response.json()
    return data.status === 'healthy' && data.setup_loaded === true
  } catch {
    return false
  }
}

type UtxoRef = {
  txid: string
  vout: number
}

type GenerateClaimProofInput = {
  /** r-component of the ECDSA signature (hex string). */
  signatureR: string
  /** s-component of the ECDSA signature (hex string). */
  signatureS: string
  /** Compressed secp256k1 public key (66-char hex string). */
  publicKey: string
  /** UTXOs to include in the claim. */
  utxos: UtxoRef[]
  /** QBTC bech32 address of the claimer. */
  claimerAddress: string
  /** QBTC chain ID (e.g., "qbtc-1"). */
  chainId: string
  /** Proof service base URL. Defaults to {@link defaultProofServiceUrl}. */
  baseUrl?: string
}

type GenerateClaimProofResponse = {
  /** Hex-encoded PLONK ZK proof. */
  proof: string
  /** 64-char hex MessageHash. */
  message_hash: string
  /** 40-char hex AddressHash (Hash160). */
  address_hash: string
  /** 64-char hex QBTCAddressHash. */
  qbtc_address_hash: string
  /** UTXOs included in the proof. */
  utxos: UtxoRef[]
  /** QBTC claimer address. */
  claimer_address: string
}

export type { GenerateClaimProofResponse as ClaimProofResult }

const isHexWithLength = (value: unknown, length: number): value is string =>
  typeof value === 'string' &&
  value.length === length &&
  /^[0-9a-f]+$/i.test(value)

/** Validates the proof service response matches expected field formats. */
const assertValidClaimProofResponse = (
  data: GenerateClaimProofResponse
): void => {
  if (typeof data.proof !== 'string' || data.proof.length === 0) {
    throw new Error('Invalid proof service response: missing proof')
  }
  if (!isHexWithLength(data.message_hash, 64)) {
    throw new Error('Invalid proof service response: invalid message_hash')
  }
  if (!isHexWithLength(data.address_hash, 40)) {
    throw new Error('Invalid proof service response: invalid address_hash')
  }
  if (!isHexWithLength(data.qbtc_address_hash, 64)) {
    throw new Error(
      'Invalid proof service response: invalid qbtc_address_hash'
    )
  }
}

/**
 * Calls the proof service to generate a PLONK ZK proof for the QBTC claim.
 * This proves BTC address ownership without revealing the private key,
 * public key, or signature.
 *
 * Timeout: up to 300 seconds — proof generation is computationally expensive.
 */
export const generateClaimProof = async ({
  signatureR,
  signatureS,
  publicKey,
  utxos,
  claimerAddress,
  chainId,
  baseUrl = defaultProofServiceUrl,
}: GenerateClaimProofInput): Promise<GenerateClaimProofResponse> => {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    proofGenerationTimeoutMs
  )

  try {
    const response = await fetch(`${baseUrl}/prove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        signature_r: signatureR,
        signature_s: signatureS,
        public_key: publicKey,
        utxos: utxos.map(({ txid, vout }) => ({ txid, vout })),
        claimer_address: claimerAddress,
        chain_id: chainId,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Proof service error (${response.status}): ${text}`)
    }

    const data: GenerateClaimProofResponse = await response.json()
    assertValidClaimProofResponse(data)
    return data
  } finally {
    clearTimeout(timeout)
  }
}
