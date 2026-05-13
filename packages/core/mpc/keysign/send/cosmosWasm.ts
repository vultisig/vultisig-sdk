import { create } from '@bufbuild/protobuf'
import { Chain, IbcEnabledCosmosChain } from '@vultisig/core-chain/Chain'
import { isCosmosWasmTokenId } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import {
  WasmExecuteContractPayload,
  WasmExecuteContractPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

const isIbcEnabledCosmosChain = (chain: Chain): chain is IbcEnabledCosmosChain =>
  Object.values(IbcEnabledCosmosChain).some(value => value === chain)

export const getCosmosWasmTokenTransferPayload = ({
  coin,
  receiver,
  amount,
}: {
  coin: AccountCoin
  receiver: string
  amount: bigint
}): WasmExecuteContractPayload | undefined => {
  const id = coin.id

  if (!isIbcEnabledCosmosChain(coin.chain) || !isCosmosWasmTokenId(id)) {
    return undefined
  }

  return create(WasmExecuteContractPayloadSchema, {
    senderAddress: coin.address,
    contractAddress: id,
    executeMsg: JSON.stringify({
      transfer: {
        recipient: receiver,
        amount: amount.toString(),
      },
    }),
    coins: [],
  })
}
