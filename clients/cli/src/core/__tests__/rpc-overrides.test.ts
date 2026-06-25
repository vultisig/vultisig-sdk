import { Chain } from '@vultisig/core-chain/Chain'
import { clearCustomRpcOverride, getCustomRpcOverride } from '@vultisig/core-chain/chains/customRpc/customRpcOverrides'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyRpcOverrides, parseRpcOverrideSpec, resolveRpcOverrides } from '../rpc-overrides'

const RPC_ENV_KEYS = ['VULTISIG_ETHEREUM_RPC', 'VULTISIG_POLYGON_RPC', 'VULTISIG_THORCHAIN_RPC', 'VULTISIG_ETH_RPC']

function clearRpcEnv(): void {
  for (const key of RPC_ENV_KEYS) delete process.env[key]
}

function clearAllOverrides(): void {
  for (const chain of Object.values(Chain)) {
    clearCustomRpcOverride(chain as Chain)
  }
}

describe('rpc-overrides', () => {
  beforeEach(() => {
    clearRpcEnv()
    clearAllOverrides()
  })

  afterEach(() => {
    clearRpcEnv()
    clearAllOverrides()
  })

  describe('parseRpcOverrideSpec', () => {
    it('splits on the first colon so the URL scheme/port survive', () => {
      expect(parseRpcOverrideSpec('ethereum:https://node.example:8545/rpc')).toEqual({
        chain: 'ethereum',
        url: 'https://node.example:8545/rpc',
      })
    })

    it('returns undefined for a malformed spec', () => {
      expect(parseRpcOverrideSpec('ethereum')).toBeUndefined()
      expect(parseRpcOverrideSpec(':https://x')).toBeUndefined()
      expect(parseRpcOverrideSpec('ethereum:')).toBeUndefined()
    })
  })

  describe('resolveRpcOverrides + applyRpcOverrides', () => {
    it('honors a VULTISIG_<CHAIN>_RPC env override and applies it to the engine', async () => {
      const sentinel = 'https://sentinel.eth.example/rpc'
      const resolution = resolveRpcOverrides({ env: { VULTISIG_ETHEREUM_RPC: sentinel } })

      expect(resolution.applied).toEqual([{ chain: Chain.Ethereum, url: sentinel }])

      await applyRpcOverrides(resolution)
      // The override must reach the engine that getEvmRpcUrl reads from — and
      // must NOT be the hardcoded public node default.
      expect(getCustomRpcOverride(Chain.Ethereum)).toBe(sentinel)
      expect(getCustomRpcOverride(Chain.Ethereum)).not.toContain('llamarpc.com')
    })

    it('honors a --rpc-override CLI spec (alias resolved)', async () => {
      const sentinel = 'https://sentinel.poly.example/rpc'
      const resolution = resolveRpcOverrides({ specs: [`matic:${sentinel}`] })

      expect(resolution.applied).toEqual([{ chain: Chain.Polygon, url: sentinel }])

      await applyRpcOverrides(resolution)
      expect(getCustomRpcOverride(Chain.Polygon)).toBe(sentinel)
    })

    it('lets a CLI flag override the env var for the same chain', () => {
      const resolution = resolveRpcOverrides({
        env: { VULTISIG_ETHEREUM_RPC: 'https://from-env.example' },
        specs: ['ethereum:https://from-flag.example'],
      })
      expect(resolution.applied).toEqual([{ chain: Chain.Ethereum, url: 'https://from-flag.example' }])
    })

    it('ignores overrides for chains that do not support custom RPC', () => {
      const resolution = resolveRpcOverrides({ specs: ['thorchain:https://thor.example'] })
      expect(resolution.applied).toEqual([])
      expect(resolution.warnings).toHaveLength(1)
      expect(resolution.warnings[0]).toMatch(/EVM and IBC Cosmos/)
    })

    it('ignores unknown chains and malformed specs with a warning', () => {
      const resolution = resolveRpcOverrides({ specs: ['notachain:https://x.example', 'garbage'] })
      expect(resolution.applied).toEqual([])
      expect(resolution.warnings).toHaveLength(2)
    })
  })
})
