import { CosmosChain } from '@vultisig/core-chain/Chain'

export const tendermintRpcUrl: Record<CosmosChain, string> = {
  Cosmos: 'https://cosmos-rpc.publicnode.com:443',
  Osmosis: 'https://osmosis-rpc.publicnode.com:443',
  Dydx: 'https://dydx-rpc.publicnode.com:443',
  Kujira: 'https://kujira-rpc.polkachu.com', // kujira-rpc.publicnode.com 403s "unsupported platform"
  Terra: 'https://terra-rpc.publicnode.com:443',
  TerraClassic: 'https://terra-classic-rpc.publicnode.com:443',
  Noble: 'https://noble-rpc.polkachu.com/',
  THORChain: 'https://gateway.liquify.com/chain/thorchain_rpc',
  MayaChain: 'https://tendermint.mayachain.info',
  Akash: 'https://akash-rpc.publicnode.com:443',
}
