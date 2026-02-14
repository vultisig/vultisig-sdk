/** Risk level from security scanning */
export type RiskLevel = 'medium' | 'high'

/** Transaction security validation result */
export type TransactionValidationResult = {
  /** Whether the transaction was flagged as risky */
  isRisky: boolean
  /** Risk level if risky (null if safe) */
  riskLevel: RiskLevel | null
  /** Human-readable description of the risk */
  description: string | undefined
  /** Detailed risk features/reasons */
  features: string[]
}

/** Transaction simulation result */
export type TransactionSimulationResult = {
  /** Chain kind that was simulated */
  chainKind: 'evm' | 'solana'
  /** Raw simulation data (chain-specific shape) */
  simulation: unknown
}

/** Site malicious scan result */
export type SiteScanResult = {
  /** Whether the site is flagged as malicious */
  isMalicious: boolean
  /** The URL that was scanned */
  url: string
}
