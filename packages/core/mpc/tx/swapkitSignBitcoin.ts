import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { Psbt } from 'bitcoinjs-lib'

import { KeysignPayload } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SignBitcoin } from '../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

export const getSwapKitSignBitcoin = (keysignPayload: KeysignPayload): SignBitcoin | undefined => {
  if (keysignPayload.signData.case === 'signBitcoin') {
    return keysignPayload.signData.value
  }

  const { coin, swapPayload } = keysignPayload

  if (
    !coin ||
    coin.chain !== Chain.Bitcoin ||
    swapPayload.case !== 'swapkitSwapPayload' ||
    swapPayload.value.txType.toUpperCase() !== 'PSBT'
  ) {
    return undefined
  }

  const txPayload = swapPayload.value.txPayload

  if (txPayload.length === 0) {
    throw new Error('SwapKit Bitcoin PSBT payload is empty.')
  }

  return buildSignBitcoinFromPsbt({
    psbt: Psbt.fromBuffer(Buffer.from(txPayload)),
    senderAddress: coin.address,
  })
}
