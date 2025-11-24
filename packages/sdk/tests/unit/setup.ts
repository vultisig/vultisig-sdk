/**
 * Unit test setup
 * Configures GlobalStorage and GlobalCrypto for tests
 */
import { configureCrypto } from '../../src/crypto'
import { NodeCrypto } from '../../src/platforms/node/crypto'
import { GlobalStorage } from '../../src/storage/GlobalStorage'
import { MemoryStorage } from '../../src/storage/MemoryStorage'

// Configure GlobalStorage with MemoryStorage for all unit tests
GlobalStorage.configure(new MemoryStorage())

// Configure GlobalCrypto with NodeCrypto for all unit tests (tests run in Node.js)
configureCrypto(new NodeCrypto())
