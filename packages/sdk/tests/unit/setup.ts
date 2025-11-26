/**
 * Unit test setup
 * Configures GlobalStorage and GlobalCrypto for tests
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
import { GlobalStorage } from '../../src/storage/GlobalStorage'
import { MemoryStorage } from '../../src/storage/MemoryStorage'

// Configure GlobalStorage with MemoryStorage for all unit tests
GlobalStorage.configure(new MemoryStorage())

// Configure GlobalCrypto with NodeCrypto for all unit tests (tests run in Node.js)
configureCrypto(new NodeCrypto())
