# Vultisig MCP TypeScript Rewrite Plan

## Overview

Rewrite the Go MCP server (`vultisig-mcp`) in TypeScript as `vultisig-mcp-ts`, consuming `@vultisig/sdk` for all chain operations. The TS MCP will be a thin wrapper - each tool delegates to an SDK method, formats the result, and returns it.

## Project Setup

### Location & Tooling

```
~/Sites/vultisig-mcp-ts/
```

- **Runtime**: Node.js (LTS)
- **Package manager**: pnpm (fast, deduplicates node_modules)
- **MCP SDK**: `@modelcontextprotocol/sdk` (v1.29+)
- **Schema validation**: `zod` (ships with MCP SDK)
- **TypeScript**: strict mode
- **Test framework**: vitest
- **Linting**: eslint + prettier (flat config)
- **Build**: tsup (fast, zero-config TS bundler)

### SDK Linking

Use pnpm workspace linking for local dev:
```bash
# In vultisig-mcp-ts/
pnpm link /Users/gomes/Sites/vultisig-sdk/.claude/worktrees/glimmering-purring-sketch/packages/sdk
```

Or `file:` protocol in package.json for reproducibility:
```json
{
  "dependencies": {
    "@vultisig/sdk": "file:../vultisig-sdk/packages/sdk"
  }
}
```

### Transport

- **Primary**: stdio (standard for MCP, how Claude Code consumes it)
- **Secondary**: HTTP mode on port **8090** (avoids Go MCP's 8080)
  - Go MCP default: `:8080` (with `-http` flag)
  - TS MCP: `:8090`

### Verification Strategy

Run both servers, curl both, compare:
```bash
# Terminal 1: Go MCP (existing)
cd ~/Sites/vultisig-mcp && go run ./cmd/mcp-server -http :8080

# Terminal 2: TS MCP (new)
cd ~/Sites/vultisig-mcp-ts && pnpm dev --http :8090

# Compare responses
curl -X POST http://localhost:8080/mcp -d '{"tool":"get_address","args":{"chain":"Ethereum"}}' > go_result.json
curl -X POST http://localhost:8090/mcp -d '{"tool":"get_address","args":{"chain":"Ethereum"}}' > ts_result.json
diff go_result.json ts_result.json
```

---

## Project Structure

```
vultisig-mcp-ts/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── .eslintrc.js
├── .prettierrc
├── .gitignore
├── .env.example
├── .env                    # gitignored
├── upstreams.json          # upstream MCP server configs
├── src/
│   ├── index.ts            # Entry point: create server, register tools, start transport
│   ├── config.ts           # Env var loading, defaults, typing
│   ├── server.ts           # McpServer setup, HTTP/stdio transport
│   ├── tools/
│   │   ├── index.ts        # registerAll(server, ctx) - registers every tool
│   │   ├── types.ts        # Shared types (ToolContext, result helpers)
│   │   ├── utility/        # set_vault_info, get_address, search_token, get_price, get_tx_status, convert_amount
│   │   ├── balance/        # All per-chain balance tools
│   │   ├── fee/            # All fee rate tools
│   │   ├── send/           # All build_*_send tools
│   │   ├── swap/           # build_swap_tx
│   │   ├── evm/            # evm_call, evm_tx_info, evm_check_allowance, abi_encode, abi_decode, resolve_ens, resolve_selector, build_evm_tx
│   │   ├── defi/           # defi_get_protocol, defi_search_yields, defi_chain_tvl
│   │   ├── polymarket/     # All polymarket tools
│   │   ├── pumpfun/        # get_pumpfun_token_info, build_pumpfun_create
│   │   └── verifier/       # get_recipe_schema, suggest_policy, check_plugin_installed, check_billing_status
│   └── lib/
│       ├── vault-store.ts  # Session vault state (ecdsa/eddsa keys, chain code)
│       ├── defi-llama.ts   # DeFiLlama API client
│       ├── polymarket.ts   # Polymarket CLOB API client
│       └── pumpfun.ts      # Pump.fun Solana program client
├── skills/                 # Markdown skill files (served via resources)
└── tests/
    ├── tools/              # Per-tool tests
    └── helpers/            # Test utilities, mock SDK
```

---

## .env.example

```bash
# RPC Endpoints (optional - SDK uses defaults via api.vultisig.com proxy)
# EVM_ETHEREUM_URL=https://...
# SOLANA_RPC_URL=https://...

# API Keys
NANSEN_API_KEY=
ETHERSCAN_API_KEY=

# Upstream MCP servers
MCP_UPSTREAMS=upstreams.json

# Verifier (optional)
VERIFIER_URL=http://localhost:8080
VERIFIER_API_KEY=

# Server
HTTP_PORT=8090
```

---

## .gitignore

```
node_modules/
dist/
.env
.env.local
.env.*.local
*.log
logs/
.DS_Store
.idea/
.vscode/
*.swp
*.swo
*~
```

---

## Tool-to-SDK Mapping (exhaustive)

### Phase 1 - Pre-existing SDK capabilities (thin wrappers)

These tools map directly to SDK methods that existed BEFORE our tools layer addition.

| # | MCP Tool | SDK Method | Notes |
|---|----------|-----------|-------|
| 1 | `set_vault_info` | Store in session `VaultStore` | Local state, no SDK call |
| 2 | `get_address` | `vault.address(chain)` or derive from pubkeys | SDK address derivation |
| 3 | `get_price` | CoinGecko via SDK pricing | SDK has `getCoinPrices` in core |
| 4 | `get_tx_status` | `TxStatusResolver` in core | SDK has tx status |
| 5 | `convert_amount` | Pure math (decimals conversion) | No SDK needed |
| 6 | `evm_get_balance` | `vault.balance(chain)` | SDK BalanceService |
| 7 | `evm_get_token_balance` | `vault.balance(chain, tokenId)` | SDK BalanceService |
| 8 | `get_sol_balance` | `vault.balance(Chain.Solana)` | SDK BalanceService |
| 9 | `get_spl_token_balance` | `vault.balance(Chain.Solana, mint)` | SDK BalanceService |
| 10 | `get_utxo_balance` | `vault.balance(chain)` | All UTXO chains |
| 11 | `get_xrp_balance` | `vault.balance(Chain.Ripple)` | SDK BalanceService |
| 12 | `get_trx_balance` | `vault.balance(Chain.Tron)` | SDK BalanceService |
| 13 | `get_trc20_token_balance` | `vault.balance(Chain.Tron, contract)` | SDK BalanceService |
| 14 | `get_atom_balance` | `vault.balance(Chain.Cosmos)` | SDK BalanceService |
| 15 | `get_cardano_balance` | `vault.balance(Chain.Cardano)` | SDK BalanceService |
| 16 | `get_ton_balance` | `vault.balance(Chain.Ton)` | SDK BalanceService |
| 17 | `get_ton_jetton_balance` | `vault.balance(Chain.Ton, jetton)` | SDK BalanceService |
| 18 | `get_sui_balance` | `vault.balance(Chain.Sui)` | SDK BalanceService |
| 19 | `get_sui_token_balance` | `vault.balance(Chain.Sui, coinType)` | Fixed in SDK |
| 20 | `get_tron_account_resources` | `getTronAccountResources()` in core | SDK core export |
| 21 | `btc_fee_rate` | `vault.gas(Chain.Bitcoin)` | SDK GasEstimation |
| 22 | `ltc_fee_rate` | `vault.gas(Chain.Litecoin)` | SDK GasEstimation |
| 23 | `doge_fee_rate` | `vault.gas(Chain.Dogecoin)` | SDK GasEstimation |
| 24 | `bch_fee_rate` | `vault.gas(Chain.BitcoinCash)` | SDK GasEstimation |
| 25 | `dash_fee_rate` | `vault.gas(Chain.Dash)` | SDK GasEstimation |
| 26 | `maya_fee_rate` | `vault.gas(Chain.MayaChain)` | SDK GasEstimation |
| 27 | `build_evm_tx` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 28 | `build_solana_tx` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 29 | `build_spl_transfer_tx` | `vault.prepareSendTx()` with SPL coin | SDK TransactionBuilder |
| 30 | `build_btc_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 31 | `build_ltc_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 32 | `build_doge_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 33 | `build_bch_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 34 | `build_zec_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 35 | `build_dash_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 36 | `build_xrp_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 37 | `build_trx_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 38 | `build_trc20_transfer` | `vault.prepareSendTx()` with TRC-20 | SDK TransactionBuilder |
| 39 | `build_gaia_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 40 | `build_thor_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 41 | `build_maya_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 42 | `build_cardano_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 43 | `build_ton_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 44 | `build_ton_jetton_transfer` | `vault.prepareSendTx()` with Jetton | SDK TransactionBuilder |
| 45 | `build_sui_send` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 46 | `build_sui_token_transfer` | `vault.prepareSendTx()` | SDK TransactionBuilder |
| 47 | `build_swap_tx` | `vault.swap()` / SwapService | SDK SwapService |

### Phase 2 - New SDK tools layer

| # | MCP Tool | SDK Method | Notes |
|---|----------|-----------|-------|
| 48 | `search_token` | `searchToken()` | New tools layer |
| 49 | `evm_check_allowance` | `evmCheckAllowance()` | New tools layer |
| 50 | `evm_call` | `evmCall()` | New tools layer |
| 51 | `evm_tx_info` | `evmTxInfo()` | New tools layer |
| 52 | `abi_encode` | `abiEncode()` | New tools layer |
| 53 | `abi_decode` | `abiDecode()` | New tools layer |
| 54 | `resolve_ens` | `resolveEns()` | New tools layer |
| 55 | `resolve_selector` | `resolve4ByteSelector()` | New tools layer |
| 56 | `get_recipe_schema` | `VerifierClient.getRecipeSchema()` | New tools layer |
| 57 | `suggest_policy` | `VerifierClient.suggestPolicy()` | New tools layer |
| 58 | `check_plugin_installed` | `VerifierClient.checkPluginInstalled()` | New tools layer |
| 59 | `check_billing_status` | `VerifierClient.checkBillingStatus()` | New tools layer |

### Phase 3 - MCP-native (not in SDK, implemented directly in MCP)

| # | MCP Tool | Implementation | Notes |
|---|----------|---------------|-------|
| 60 | `defi_get_protocol` | DeFiLlama REST client in `src/lib/defi-llama.ts` | Pure API wrapper |
| 61 | `defi_search_yields` | DeFiLlama REST client | Pure API wrapper |
| 62 | `defi_chain_tvl` | DeFiLlama REST client | Pure API wrapper |
| 63 | `get_pumpfun_token_info` | Solana RPC in `src/lib/pumpfun.ts` | Niche, MCP-only |
| 64 | `build_pumpfun_create` | Solana program instruction builder | Niche, MCP-only |
| 65-75 | Polymarket (11 tools) | Polymarket CLOB client in `src/lib/polymarket.ts` | App-level |
| 76-82 | Tornado Cash (7 tools) | zk/crypto in `src/lib/tornado.ts` | Node-only, zk deps |

### Not reimplemented (upstream proxies)

These come from upstream MCP servers via `upstreams.json`, not reimplemented:
- Nansen tools (proxied via `mcp-remote`)
- Etherscan tools (proxied via `mcp-remote`)
- deBridge tools (proxied via `@debridge-finance/debridge-mcp`)

---

## Implementation Phases

### Phase 0 - Project scaffold
- Create `~/Sites/vultisig-mcp-ts/`
- `pnpm init`, install deps, configure TS/eslint/prettier/vitest
- Set up `.env.example`, `.gitignore`, `tsconfig.json`, `tsup.config.ts`
- Scaffold `src/index.ts` with McpServer, stdio + HTTP transport
- Link SDK locally
- Verify server starts and responds to health check

### Phase 1 - Core tools (SDK pre-existing, 47 tools)
Start with the tools that map to SDK capabilities that existed before our tools layer:
1. **Utility tools** (6): set_vault_info, get_address, get_price, get_tx_status, convert_amount, search_token
2. **Balance tools** (16): All per-chain balance getters
3. **Fee tools** (6): All fee rate getters
4. **Send/build tools** (18): All per-chain transaction builders
5. **Swap** (1): build_swap_tx

Each tool:
- Zod input schema matching Go MCP's parameters
- Handler that calls SDK, formats result as MCP content
- Unit test with mocked SDK

### Phase 2 - EVM utilities + verifier (12 tools)
Wire up the new SDK tools layer:
- evm_call, evm_tx_info, evm_check_allowance
- abi_encode, abi_decode
- resolve_ens, resolve_selector
- Verifier client (4 tools)

### Phase 3 - MCP-native domains (20+ tools)
Implement directly in MCP (not SDK):
- DeFiLlama client (3 tools)
- Pump.fun (2 tools)
- Polymarket (11 tools)
- Tornado Cash (7 tools)

### Phase 4 - Upstream proxies + skills
- Configure upstream MCP servers (Nansen, Etherscan, deBridge)
- Port skill/resource markdown files
- HTTP mode with CORS

### Phase 5 - Verification & parity testing
- Automated comparison script: curl Go MCP vs TS MCP for every tool
- Diff responses, document any intentional differences
- Performance comparison

---

## Tool Registration Pattern

```typescript
// src/tools/balance/evm.ts
import { z } from 'zod'
import type { ToolRegistration } from '../types'

export const evmGetBalance: ToolRegistration = {
  name: 'evm_get_balance',
  config: {
    description: 'Query native coin balance on any EVM chain',
    inputSchema: z.object({
      chain: z.string().default('Ethereum'),
      address: z.string().optional(),
    }),
    annotations: { readOnlyHint: true },
  },
  handler: async ({ chain, address }, ctx) => {
    const addr = address ?? ctx.vaultStore.getAddress(chain)
    const balance = await ctx.sdk.balance(chain, addr)
    return {
      content: [{ type: 'text', text: JSON.stringify({ chain, address: addr, balance }) }],
    }
  },
}

// src/tools/index.ts
import type { McpServer } from '@modelcontextprotocol/server'
import type { ToolContext } from './types'
import { evmGetBalance } from './balance/evm'
// ... all other tools

const allTools: ToolRegistration[] = [evmGetBalance, /* ... */]

export function registerAll(server: McpServer, ctx: ToolContext) {
  for (const tool of allTools) {
    server.registerTool(tool.name, tool.config, (args) => tool.handler(args, ctx))
  }
}
```

---

## package.json (draft)

```json
{
  "name": "vultisig-mcp-ts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "dev:http": "tsx src/index.ts --http 8090",
    "build": "tsup",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@vultisig/sdk": "file:../vultisig-sdk/packages/sdk",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

---

## tsconfig.json (draft)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## Key Design Decisions

1. **No Express/Hono needed** - MCP SDK handles transport (stdio + built-in HTTP via `NodeStreamableHTTPServerTransport`)
2. **pnpm** for package management (faster, deduplicates)
3. **Zod schemas** for tool inputs (MCP SDK uses Zod natively)
4. **Strong typing end-to-end** - tool inputs typed via Zod, SDK returns typed, MCP responses typed
5. **Session state** - `VaultStore` class holds vault pubkeys per session (replaces Go's `vault.Store`)
6. **SDK link** - local file: protocol link, no Verdaccio needed
7. **Port 8090** - avoids conflict with Go MCP on 8080
8. **Upstream servers** - reuse same `upstreams.json` format, spawn child processes
