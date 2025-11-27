/**
 * Unit test setup
 * Configures crypto for Node.js test environment
 *
 * NOTE: Tests use instance-scoped patterns via createSdkContext()
 * No global singletons are configured here.
 */
import { vi } from 'vitest'

// Mock @lifi/sdk to avoid @solana/web3.js v2/v1 conflict
// The SDK uses v2.0 while @lifi/sdk requires v1.x (PublicKey export)
// Swap functionality is tested via mocked dependencies
vi.mock('@lifi/sdk', () => ({
  ChainId: {
    ETH: 1,
    POL: 137,
    BSC: 56,
    AVA: 43114,
    ARB: 42161,
    OPT: 10,
    BAS: 8453,
    SOL: 1151111081099710,
  },
  getQuote: vi.fn(),
  getRoutes: vi.fn(),
}))

import { configureCrypto } from '../../src/crypto'
import { NodeCrypto } from '../../src/platforms/node/crypto'

// Configure crypto for Node.js test environment
configureCrypto(new NodeCrypto())
