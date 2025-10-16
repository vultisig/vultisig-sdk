/**
 * Explorer URL generation utilities for different blockchains
 */
export class ExplorerLinks {
  /**
   * Generate transaction explorer URL
   */
  static getTransactionUrl(chain: string, hash: string): string {
    const chainLower = chain.toLowerCase()

    const explorers: Record<string, string> = {
      // EVM chains
      ethereum: `https://etherscan.io/tx/${hash}`,
      polygon: `https://polygonscan.com/tx/${hash}`,
      arbitrum: `https://arbiscan.io/tx/${hash}`,
      optimism: `https://optimistic.etherscan.io/tx/${hash}`,
      base: `https://basescan.org/tx/${hash}`,
      avalanche: `https://snowtrace.io/tx/${hash}`,
      bsc: `https://bscscan.com/tx/${hash}`,
      cronos: `https://cronoscan.com/tx/${hash}`,
      mantle: `https://mantlescan.info/tx/${hash}`,
      blast: `https://blastscan.io/tx/${hash}`,
      zksync: `https://explorer.zksync.io/tx/${hash}`,

      // UTXO chains
      bitcoin: `https://blockstream.info/tx/${hash}`,
      litecoin: `https://blockchair.com/litecoin/transaction/${hash}`,
      dogecoin: `https://blockchair.com/dogecoin/transaction/${hash}`,
      bitcoin_cash: `https://blockchair.com/bitcoin-cash/transaction/${hash}`,

      // Other chains
      solana: `https://solscan.io/tx/${hash}`,
      cosmos: `https://www.mintscan.io/cosmos/txs/${hash}`,
      osmosis: `https://www.mintscan.io/osmosis/txs/${hash}`,
      thorchain: `https://viewblock.io/thorchain/tx/${hash}`,
      maya: `https://www.mintscan.io/maya-protocol/txs/${hash}`,
      sui: `https://suiexplorer.com/txblock/${hash}`,
      polkadot: `https://polkascan.io/polkadot/transaction/${hash}`,
      ton: `https://tonscan.org/tx/${hash}`,
      ripple: `https://xrpscan.com/tx/${hash}`,
      tron: `https://tronscan.org/#/transaction/${hash}`,
      cardano: `https://cardanoscan.io/transaction/${hash}`,
    }

    return (
      explorers[chainLower] || `https://explorer.${chainLower}.com/tx/${hash}`
    )
  }

  /**
   * Generate address explorer URL
   */
  static getAddressUrl(chain: string, address: string): string {
    const chainLower = chain.toLowerCase()

    const explorers: Record<string, string> = {
      // EVM chains
      ethereum: `https://etherscan.io/address/${address}`,
      polygon: `https://polygonscan.com/address/${address}`,
      arbitrum: `https://arbiscan.io/address/${address}`,
      optimism: `https://optimistic.etherscan.io/address/${address}`,
      base: `https://basescan.org/address/${address}`,
      avalanche: `https://snowtrace.io/address/${address}`,
      bsc: `https://bscscan.com/address/${address}`,
      cronos: `https://cronoscan.com/address/${address}`,
      mantle: `https://mantlescan.info/address/${address}`,
      blast: `https://blastscan.io/address/${address}`,
      zksync: `https://explorer.zksync.io/address/${address}`,

      // UTXO chains
      bitcoin: `https://blockstream.info/address/${address}`,
      litecoin: `https://blockchair.com/litecoin/address/${address}`,
      dogecoin: `https://blockchair.com/dogecoin/address/${address}`,
      bitcoin_cash: `https://blockchair.com/bitcoin-cash/address/${address}`,

      // Other chains
      solana: `https://solscan.io/account/${address}`,
      cosmos: `https://www.mintscan.io/cosmos/account/${address}`,
      osmosis: `https://www.mintscan.io/osmosis/account/${address}`,
      thorchain: `https://viewblock.io/thorchain/address/${address}`,
      maya: `https://www.mintscan.io/maya-protocol/account/${address}`,
      sui: `https://suiexplorer.com/address/${address}`,
      polkadot: `https://polkascan.io/polkadot/account/${address}`,
      ton: `https://tonscan.org/address/${address}`,
      ripple: `https://xrpscan.com/account/${address}`,
      tron: `https://tronscan.org/#/address/${address}`,
      cardano: `https://cardanoscan.io/address/${address}`,
    }

    return (
      explorers[chainLower] ||
      `https://explorer.${chainLower}.com/address/${address}`
    )
  }

  /**
   * Generate block explorer URL
   */
  static getBlockUrl(chain: string, blockNumber: number | string): string {
    const chainLower = chain.toLowerCase()

    const explorers: Record<string, string> = {
      // EVM chains
      ethereum: `https://etherscan.io/block/${blockNumber}`,
      polygon: `https://polygonscan.com/block/${blockNumber}`,
      arbitrum: `https://arbiscan.io/block/${blockNumber}`,
      optimism: `https://optimistic.etherscan.io/block/${blockNumber}`,
      base: `https://basescan.org/block/${blockNumber}`,
      avalanche: `https://snowtrace.io/block/${blockNumber}`,
      bsc: `https://bscscan.com/block/${blockNumber}`,
      cronos: `https://cronoscan.com/block/${blockNumber}`,
      mantle: `https://mantlescan.info/block/${blockNumber}`,
      blast: `https://blastscan.io/block/${blockNumber}`,
      zksync: `https://explorer.zksync.io/block/${blockNumber}`,

      // UTXO chains
      bitcoin: `https://blockstream.info/block/${blockNumber}`,
      litecoin: `https://blockchair.com/litecoin/block/${blockNumber}`,
      dogecoin: `https://blockchair.com/dogecoin/block/${blockNumber}`,
      bitcoin_cash: `https://blockchair.com/bitcoin-cash/block/${blockNumber}`,

      // Other chains
      solana: `https://solscan.io/block/${blockNumber}`,
      cosmos: `https://www.mintscan.io/cosmos/blocks/${blockNumber}`,
      osmosis: `https://www.mintscan.io/osmosis/blocks/${blockNumber}`,
      thorchain: `https://viewblock.io/thorchain/block/${blockNumber}`,
      maya: `https://www.mintscan.io/maya-protocol/blocks/${blockNumber}`,
      sui: `https://suiexplorer.com/epoch/${blockNumber}`,
      polkadot: `https://polkascan.io/polkadot/block/${blockNumber}`,
      ton: `https://tonscan.org/block/${blockNumber}`,
      ripple: `https://xrpscan.com/ledger/${blockNumber}`,
      tron: `https://tronscan.org/#/block/${blockNumber}`,
      cardano: `https://cardanoscan.io/block/${blockNumber}`,
    }

    return (
      explorers[chainLower] ||
      `https://explorer.${chainLower}.com/block/${blockNumber}`
    )
  }
}
