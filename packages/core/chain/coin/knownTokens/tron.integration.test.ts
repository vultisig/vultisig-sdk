import { Chain } from '@vultisig/core-chain/Chain'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { describe, expect, it } from 'vitest'

import { knownTokens } from '.'

const runLiveTronGridRegistryCheck = process.env.VULTISIG_TRON_TOKEN_REGISTRY_LIVE === '1'
const tronGridConstantContractUrl = 'https://api.trongrid.io/wallet/triggerconstantcontract'
const tronGridOwnerAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'

type TriggerConstantContractResponse = {
  constant_result?: string[]
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const decodeTrc20String = (hex: string): string => {
  if (hex.length < 128) {
    return Buffer.from(hex, 'hex').toString('utf8').replace(/\0/g, '').trim()
  }

  const lengthHex = hex.slice(64, 128)
  const length = parseInt(lengthHex, 16)
  const dataHex = hex.slice(128, 128 + length * 2)

  return Buffer.from(dataHex, 'hex').toString('utf8')
}

const fetchTronTokenSymbol = async (contractAddress: string): Promise<string> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await queryUrl<TriggerConstantContractResponse>(tronGridConstantContractUrl, {
        body: {
          contract_address: contractAddress,
          function_selector: 'symbol()',
          owner_address: tronGridOwnerAddress,
          visible: true,
        },
      })

      const symbolHex = response.constant_result?.[0]
      if (!symbolHex) {
        throw new Error(`Failed to fetch symbol for token ${contractAddress}`)
      }

      return decodeTrc20String(symbolHex)
    } catch (error) {
      if (attempt === 2 || !String(error).includes('request rate exceeded')) {
        throw error
      }

      await wait(6_000)
    }
  }

  throw new Error(`Failed to fetch symbol for token ${contractAddress}`)
}

describe.skipIf(!runLiveTronGridRegistryCheck)('knownTokens[Chain.Tron] live symbol integrity', () => {
  const tronTokens = knownTokens[Chain.Tron]

  it('matches on-chain TRC-20 symbol() metadata', async () => {
    expect(tronTokens.length).toBeGreaterThan(0)

    for (const token of tronTokens) {
      const tokenId = shouldBePresent(token.id)
      const symbol = await fetchTronTokenSymbol(tokenId)

      expect(symbol, `${tokenId} symbol()`).toBe(token.ticker)
      await wait(400)
    }
  }, 60_000)
})
