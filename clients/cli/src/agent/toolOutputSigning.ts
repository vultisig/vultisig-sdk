/**
 * CLI re-export of the SDK-owned tool-output → signable-candidate contract
 * (`packages/sdk/src/tx/toolOutputSigning.ts`, #1676).
 *
 * Existing CLI import paths stay stable. Behavior is pinned by the SDK
 * characterization tests plus the CLI executor/session integration tests.
 */
export type { SignableTxCandidatePayload, ToolOutputCandidate, TxReadyPayload } from '@vultisig/sdk'
export {
  asRecord,
  buildTxReadyFromToolOutput,
  buildTxReadyFromYieldOutput,
  CLI_SIGNABLE_FLAT_TOOLS,
  CLI_SIGNABLE_PREP_TOOLS,
  CLI_SIGNABLE_YIELD_TOOLS,
  deriveToolOutputCandidate,
  DIVERGENT_FIELD_TOOLS,
  payloadLooksSignable,
  POLYMARKET_DEPOSIT_TOOL,
  POLYMARKET_SETUP_TRADING_TOOL,
} from '@vultisig/sdk'
