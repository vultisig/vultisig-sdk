import { attempt } from '@vultisig/lib-utils/attempt'
import { Interface } from 'ethers'

import { type EvmActionLabel, lookupCommonEvmSelector } from '../commonSelectors'
import { getEvmContractCallHexSignature } from './hexSignature'
import { getEvmContractCallSignatures } from './signatures'

export type EvmContractCallInfo = {
  functionSignature: string
  functionArguments: string
  actionLabel?: EvmActionLabel
}

const decodeFunctionArguments = (textSignature: string, value: string): string | null => {
  const result = attempt(() => {
    const abi = new Interface([`function ${textSignature}`])
    const [fragment] = textSignature.split('(')
    return abi.decodeFunctionData(fragment, value)
  })

  if ('error' in result) {
    return null
  }

  return JSON.stringify(
    result.data,
    (_, v) => {
      if (typeof v === 'bigint') {
        return v.toString()
      }
      if (v && typeof v === 'object') {
        const maybe = v as {
          _isBigNumber?: boolean
          toString?: () => string
        }
        if (maybe._isBigNumber && typeof maybe.toString === 'function') {
          return maybe.toString()
        }
      }
      return v
    },
    2
  )
}

export const getEvmContractCallInfo = async (value: string): Promise<EvmContractCallInfo | null> => {
  const hexSignature = getEvmContractCallHexSignature(value)

  // Fast offline path: check the static common-selector table first.
  const known = lookupCommonEvmSelector(hexSignature)
  if (known) {
    const functionArguments = decodeFunctionArguments(known.signature, value)
    if (functionArguments !== null) {
      return {
        functionSignature: known.signature,
        functionArguments,
        actionLabel: known.actionLabel,
      }
    }
  }

  const { data } = await attempt(getEvmContractCallSignatures(hexSignature))

  if (!data) {
    return null
  }

  const { results } = data

  const [result] = results
  if (!result) {
    return null
  }

  const { text_signature } = result
  if (!text_signature) {
    return null
  }

  const functionArguments = decodeFunctionArguments(text_signature, value)
  if (functionArguments === null) {
    return null
  }

  return {
    functionArguments,
    functionSignature: text_signature,
  }
}
