/**
 * Unit test setup
 * Configures GlobalStorage for tests
 */
import { GlobalStorage } from '../../src/storage/GlobalStorage'
import { MemoryStorage } from '../../src/storage/MemoryStorage'

// Configure GlobalStorage with MemoryStorage for all unit tests
GlobalStorage.configure(new MemoryStorage())
