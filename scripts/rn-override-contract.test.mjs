import assert from 'node:assert/strict'
import test from 'node:test'

import { findRnOverrideTarget, rnOverridePlugin, rnOverrideTargets } from '../packages/sdk/rollup.platforms.config.js'

test('React Native override matcher accepts every source and dist path variant', () => {
  for (const target of rnOverrideTargets) {
    for (const suffix of target.suffixes) {
      assert.equal(findRnOverrideTarget(`/checkout/${suffix}`), target)
      assert.equal(findRnOverrideTarget(`C:\\checkout\\${suffix.replaceAll('/', '\\')}`), target)
    }
  }

  assert.equal(findRnOverrideTarget('/checkout/packages/core/chain/chains/solana/not-client.ts'), undefined)
  assert.equal(findRnOverrideTarget('/checkout/unrelated/packages/core/chain/chains/sui/client.ts.bak'), undefined)
})

const pluginContext = resolvedId => ({
  error(message) {
    throw new Error(message)
  },
  info() {},
  async resolve() {
    return { id: resolvedId }
  },
})

test('React Native override plugin fails when a logical target is not intercepted', async () => {
  const plugin = rnOverridePlugin()
  plugin.buildStart()
  const omittedTarget = rnOverrideTargets.at(-1)

  for (const target of rnOverrideTargets.slice(0, -1)) {
    const suffix = target.suffixes[0]
    const context = pluginContext(`/checkout/${suffix}`)
    assert.match(await plugin.resolveId.call(context, suffix, '/checkout/importer.js', {}), new RegExp(target.override))
  }

  assert.throws(
    () => plugin.buildEnd.call(pluginContext(''), undefined),
    error =>
      error.message.includes(omittedTarget.name) &&
      omittedTarget.suffixes.every(suffix => error.message.includes(suffix))
  )
})

test('React Native override plugin accepts one matched path per logical target', async () => {
  const plugin = rnOverridePlugin()
  plugin.buildStart()

  for (const target of rnOverrideTargets) {
    const suffix = target.suffixes.at(-1)
    const context = pluginContext(`C:\\checkout\\${suffix.replaceAll('/', '\\')}`)
    await plugin.resolveId.call(context, suffix, 'C:\\checkout\\importer.js', {})
  }

  assert.doesNotThrow(() => plugin.buildEnd.call(pluginContext(''), undefined))
})
