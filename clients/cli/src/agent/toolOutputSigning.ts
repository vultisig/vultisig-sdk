/**
 * CLI compatibility surface for SDK-owned tool-output candidate derivation.
 *
 * The pure contract lives in `@vultisig/sdk`; the CLI retains its historical
 * `CLI_*` constant names so existing session consumers remain unchanged.
 */
export type {
  SignableToolOutputPayload,
  ToolOutputCandidate,
  ToolOutputCandidateFailureReason,
  ToolOutputCandidateResult,
} from '@vultisig/sdk'
export {
  buildTxReadyFromToolOutput,
  buildTxReadyFromYieldOutput,
  SIGNABLE_FLAT_TOOLS as CLI_SIGNABLE_FLAT_TOOLS,
  SIGNABLE_PREP_TOOLS as CLI_SIGNABLE_PREP_TOOLS,
  SIGNABLE_YIELD_TOOLS as CLI_SIGNABLE_YIELD_TOOLS,
  deriveToolOutputCandidate,
  deriveToolOutputCandidateResult,
  DIVERGENT_FIELD_TOOLS,
  payloadLooksSignable,
  POLYMARKET_DEPOSIT_TOOL,
  POLYMARKET_SETUP_TRADING_TOOL,
} from '@vultisig/sdk'
