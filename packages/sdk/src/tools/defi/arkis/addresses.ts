// Arkis published mainnet contract addresses.
//
// Pinned from Arkis docs:
// https://docs.arkis.xyz/home/for-developers/high-level-architecture
//
// Lender-side scaffold is Ethereum mainnet only. Hyperliquid L1 wrapper
// collateral, margin-account vault allocation, direct borrow, and withdrawals
// are intentionally out of scope here.
export const ARKIS_OFFICIAL_ADDRESSES = {
  dispatcher: '0x2f01D7CFfe62673B3D2b680295A2D047F3848e4c',
  compliance: '0x286496C568368e036062781F807db5ea3E56d3e8',
  agreementFactoryV2: '0xbbC9c04348E093473C5b176Cb4b103fF706528bf',
  leverage: '0xe70d11D23F36826C58f30C61B4DeAf0A89a6D837',
  liquidator: '0x7ad1dd2516F1499852aAEb95a33D7Ec1BA31b5C3',
  vaultFactory: '0x76D46cb4c5cA64ba5aDCf3376E4BD3B75f0e61D2',
  vaultMarketplace: '0x1f797CC91BB598AA5aa8bafF1B1aF65f578fbAf2',
  wrapperFactory: '0xEA623eebd9c5bFd56067e36C89Db0C13e6c70ba8',
} as const

export const ARKIS_BOOK_URLS = {
  lend: 'https://arkis-assets.s3.eu-central-1.amazonaws.com/public/Arkis_Lend_Book.csv',
  borrow: 'https://arkis-assets.s3.eu-central-1.amazonaws.com/public/Arkis_Borrow_Book.csv',
} as const
