export const generalSwapProviders = ['1inch', 'li.fi', 'kyber', 'swapkit', 'cowswap', 'jupiter'] as const

export type GeneralSwapProvider = (typeof generalSwapProviders)[number]

export const generalSwapProviderName: Record<GeneralSwapProvider, string> = {
  '1inch': '1Inch',
  'li.fi': 'LI.FI',
  kyber: 'KyberSwap',
  swapkit: 'SwapKit',
  cowswap: 'CowSwap',
  jupiter: 'Jupiter',
}
