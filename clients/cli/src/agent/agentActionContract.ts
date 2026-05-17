/**
 * Curated list of agent `action` / tool names documented for the CLI in the
 * repository root `AGENTS.md` ("Available Actions"). When the backend or docs
 * add a new action, update this list so contract tests fail until the executor,
 * session dispatch, and docs are reconciled intentionally.
 *
 * Not every name here maps to a local `AgentExecutor` method (some run only
 * on the backend); the tests only pin subsets that must stay consistent.
 */
export const DOCUMENTED_AGENT_ACTION_TYPES = [
  'address_book',
  'build_custom_tx',
  'build_send_tx',
  'build_swap_tx',
  'build_tx',
  'get_address_book',
  'get_balances',
  'get_market_price',
  'get_portfolio',
  'list_vaults',
  'read_evm_contract',
  'scan_tx',
  'search_token',
  'sign_tx',
  'sign_typed_data',
  'thorchain_add_liquidity',
  'thorchain_pool_info',
  'thorchain_query',
  'thorchain_remove_liquidity',
  'vault_chain',
  'vault_coin',
] as const

export type DocumentedAgentActionType = (typeof DOCUMENTED_AGENT_ACTION_TYPES)[number]
