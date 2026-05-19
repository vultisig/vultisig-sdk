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
  /**
   * If true, the proof service signs and broadcasts the resulting
   * `MsgClaimWithProof` itself — using its own pre-funded broadcaster account.
   * Intended for first-time claimers whose own bech32 address doesn't yet
   * exist on chain (so they can't sign a SignDoc the chain will accept).
   * When true, the response carries `tx_hash`.
   *
   * Wired up server-side by [btcq-org/qbtc#158](https://github.com/btcq-org/qbtc/pull/158).
   */
  broadcast?: boolean
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
  /**
   * 64-char hex SHA256 of the SEC-compressed BTC pubkey. Required by
   * `MsgClaimWithProof` (proto field 7) since btcq-org/qbtc#148 — the
   * chain runs RIPEMD160 over this natively to bind the proof to the
   * BTC address.
   */
  pub_key_hash_sha256: string
  /** UTXOs included in the proof. */
  utxos: UtxoRef[]
  /** QBTC claimer address. */
  claimer_address: string
  /**
   * Set only when the request had `broadcast: true` and the proof service
   * successfully submitted the claim tx on the caller's behalf. The hash
   * matches what `cosmos.tx.v1beta1.BroadcastTxResponse.txhash` would have
   * returned for a self-broadcast.
   */
  tx_hash?: string
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
  if (!isHexWithLength(data.pub_key_hash_sha256, 64)) {
    throw new Error(
      'Invalid proof service response: invalid pub_key_hash_sha256'
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
  broadcast,
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
        ...(broadcast ? { broadcast: true } : {}),
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
