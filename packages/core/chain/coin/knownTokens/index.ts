import { Chain } from '@vultisig/core-chain/Chain'
import { rippleKnownIssuedTokens } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { makeRecord } from '@vultisig/lib-utils/record/makeRecord'
import { omit } from '@vultisig/lib-utils/record/omit'

import { CoinKey, KnownCoin, KnownCoinMetadata, Token } from '../Coin'
import { knownCosmosTokens } from './cosmos'

type LeanChainTokensRecord = Record<Chain, Record<string, KnownCoinMetadata>>

export const vult: Token<CoinKey> & KnownCoinMetadata = {
  id: '0xb788144DF611029C60b859DF47e79B7726C4DEBa',
  chain: Chain.Ethereum,
  ticker: 'VULT',
  logo: 'vult',
  decimals: 18,
  priceProviderId: 'vultisig',
}

export const usdc: Token<CoinKey> & KnownCoinMetadata = {
  id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  chain: Chain.Ethereum,
  ticker: 'USDC',
  logo: 'usdc',
  decimals: 6,
  priceProviderId: 'usd-coin',
}

const leanTokens: Partial<LeanChainTokensRecord> = {
  [Chain.Ton]: {
    EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs: {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
      priceProviderId: 'tether',
    },
    EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT: {
      ticker: 'NOT',
      logo: 'not',
      decimals: 9,
      priceProviderId: 'notcoin',
    },
    EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS: {
      ticker: 'DOGS',
      logo: 'dogs',
      decimals: 9,
      priceProviderId: 'dogs-2',
    },
    'EQD-cvR0Nz6XAyRBvbhz-abTrRC6sI5tvHvvpeQraV9UAAD7': {
      ticker: 'CATI',
      logo: 'cati',
      decimals: 9,
      priceProviderId: 'catizen',
    },
    'EQAJ8uWd7EBqsmpSWaRdf_I-8R8-XHwh3gsNKhy-UrdrPcUo': {
      ticker: 'HMSTR',
      logo: 'hmstr',
      decimals: 9,
      priceProviderId: 'hamster-kombat',
    },
    EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmwG9T6bO: {
      ticker: 'STON',
      logo: 'ston',
      decimals: 9,
      priceProviderId: 'ston-2',
    },
    'EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k': {
      ticker: 'stTON',
      logo: 'https://storage.googleapis.com/milkcreek/tokens/stTON.png',
      decimals: 9,
      priceProviderId: 'bemo-staked-ton',
    },
    EQC98_qAmNEptUtPc7W6xdHh_ZHrBUFpw5Ft_IzNU20QAJav: {
      ticker: 'tsTON',
      logo: 'tston',
      decimals: 9,
      priceProviderId: 'tonstakers',
    },
  },
  [Chain.Tron]: {
    TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
      priceProviderId: 'tether',
    },
    // CoinGecko canonical address. TronScan shows publicTag="USDCOLD" but blueTag="USDC" + 2.5M+ txns confirm this is Circle's USDC.
    TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
    // USDD canonical token. USDDOLD is the deprecated migration source and should not be used for new transfers.
    TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz: {
      ticker: 'USDD',
      logo: 'usdd',
      decimals: 18,
      priceProviderId: 'usdd',
    },
    // stUSDT JustLend liquid staking receipt token, not the Sunswap LP token with a similar symbol.
    TThzxNRLrW2Brp9DcTQU8i4Wd9udCWEdZ3: {
      ticker: 'stUSDT',
      logo: 'stusdt',
      decimals: 18,
      priceProviderId: 'staked-usdt',
    },
  },
  [Chain.Solana]: {
    // QA dogfood Bug J (paaao 2026-05-02): USDC and USDT on Solana
    // were missing from the knownTokens fast-path lookup, so the
    // agent had to fall back to CoinGecko search every time the user
    // referenced "USDC on Solana" — slower + flakier than the EVM
    // chains where Circle USDC is hard-coded. Bake the canonical
    // SPL mint addresses in directly. Mints are public, well-known,
    // and ratified by the issuers (Circle for USDC, Tether for USDT).
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
      priceProviderId: 'tether',
    },
    JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: {
      ticker: 'JUP',
      logo: 'https://static.jup.ag/jup/icon.png',
      decimals: 6,
      priceProviderId: 'jupiter-exchange-solana',
    },
    USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: {
      ticker: 'USDS',
      logo: 'usds',
      decimals: 6,
      priceProviderId: 'usds',
    },
  },
  [Chain.Ethereum]: {
    [vult.id]: omit(vult, 'id', 'chain'),
    [usdc.id]: omit(usdc, 'id', 'chain'),
    '0xdac17f958d2ee523a2206206994597c13d831ec7': {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
      priceProviderId: 'tether',
    },
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': {
      ticker: 'UNI',
      logo: 'uni',
      decimals: 18,
      priceProviderId: 'uniswap',
    },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': {
      ticker: 'WBTC',
      logo: 'wbtc',
      decimals: 8,
      priceProviderId: 'wrapped-bitcoin',
    },
    '0x514910771af9ca656af840dff83e8264ecf986ca': {
      ticker: 'LINK',
      logo: 'link',
      decimals: 18,
    },
    '0x826180541412d574cf1336d22c0c0a287822678a': {
      ticker: 'FLIP',
      logo: 'ChainFlip',
      decimals: 18,
      priceProviderId: 'chainflip',
    },
    '0x108a850856Db3f85d0269a2693D896B394C80325': {
      ticker: 'TGT',
      logo: 'tgt',
      decimals: 18,
      priceProviderId: 'thorwallet',
    },
    '0xc770eefad204b5180df6a14ee197d99d808ee52d': {
      ticker: 'FOX',
      logo: 'fox',
      decimals: 18,
      priceProviderId: 'shapeshift-fox-token',
    },
    '0x6b175474e89094c44da98b954eedeac495271d0f': {
      ticker: 'DAI',
      logo: 'dai',
      decimals: 18,
      priceProviderId: 'dai',
    },
    '0xdC035D45d973E3EC169d2276DDab16f1e407384F': {
      ticker: 'USDS',
      logo: 'usds',
      decimals: 18,
      priceProviderId: 'usds',
    },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': {
      ticker: 'WETH',
      logo: 'weth',
      decimals: 18,
      priceProviderId: 'weth',
    },
    '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e': {
      ticker: 'YFI',
      logo: 'yfi',
      decimals: 18,
      priceProviderId: 'yearn-finance',
    },
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': {
      ticker: 'AAVE',
      logo: 'aave',
      decimals: 18,
      priceProviderId: 'aave',
    },
    '0xc00e94cb662c3520282e6f5717214004a7f26888': {
      ticker: 'COMP',
      logo: 'comp',
      decimals: 18,
      priceProviderId: 'compound-governance-token',
    },
    '0x0d8775f648430679a709e98d2b0cb6250d2887ef': {
      ticker: 'BAT',
      logo: 'bat',
      decimals: 18,
      priceProviderId: 'basic-attention-token',
    },
    '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f': {
      ticker: 'SNX',
      logo: 'snx',
      decimals: 18,
      priceProviderId: 'havven',
    },
    '0xba100000625a3754423978a60c9317c58a424e3d': {
      ticker: 'BAL',
      logo: 'bal',
      decimals: 18,
      priceProviderId: 'balancer',
    },
    '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2': {
      ticker: 'SUSHI',
      logo: 'sushi',
      decimals: 18,
      priceProviderId: 'sushi',
    },
    '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': {
      ticker: 'MKR',
      logo: 'mkr',
      decimals: 18,
      priceProviderId: 'maker',
    },
    '0xdefa4e8a7bcba345f687a2f1456f5edd9ce97202': {
      ticker: 'KNC',
      logo: 'knc',
      decimals: 18,
      priceProviderId: 'kyber-network-crystal',
    },
    '0xc944e90c64b2c07662a292be6244bdf05cda44a7': {
      ticker: 'GRT',
      logo: 'grt',
      decimals: 18,
      priceProviderId: 'the-graph',
    },
    '0x6982508145454ce325ddbe47a25d4ec3d2311933': {
      ticker: 'PEPE',
      logo: 'pepe',
      decimals: 18,
      priceProviderId: 'pepe',
    },
  },
  [Chain.Avalanche]: {
    '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
    },
    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7': {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
    },
    '0x152b9d0FdC40C096757F570A51E494bd4b943E50': {
      ticker: 'BTC.b',
      logo: 'btc',
      decimals: 8,
    },
    '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE': {
      ticker: 'sAVAX',
      logo: 'savax',
      decimals: 18,
    },
    '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd': {
      ticker: 'JOE',
      logo: 'joe',
      decimals: 18,
    },
    '0x60781C2586D68229fde47564546784ab3fACA982': {
      ticker: 'PNG',
      logo: 'png',
      decimals: 18,
    },
    '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7': {
      ticker: 'WAVAX',
      logo: 'avax',
      decimals: 18,
    },
    '0x625E7708f30cA75bfd92586e17077590C60eb4cD': {
      ticker: 'aAvaUSDC',
      logo: 'aave',
      decimals: 6,
    },
    '0x46B9144771Cb3195D66e4EDA643a7493fADCAF9D': {
      ticker: 'BLS',
      logo: 'bls',
      decimals: 18,
    },
  },
  [Chain.BSC]: {
    '0x55d398326f99059fF775485246999027B3197955': {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 18,
    },
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 18,
    },
    '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': {
      ticker: 'DAI',
      logo: 'dai',
      decimals: 18,
    },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': {
      ticker: 'WETH',
      logo: 'weth',
      decimals: 18,
    },
    '0xfb6115445bff7b52feb98650c87f44907e58f802': {
      ticker: 'AAVE',
      logo: 'aave',
      decimals: 18,
    },
    '0x52ce071bd9b1c4b00a0b92d298c512478cad67e8': {
      ticker: 'COMP',
      logo: 'comp',
      decimals: 18,
    },
    '0x947950bcc74888a40ffa2593c5798f11fc9124c4': {
      ticker: 'SUSHI',
      logo: 'sushi',
      decimals: 18,
    },
    '0xfe56d5892bdffc7bf58f2e84be1b2c32d21c308b': {
      ticker: 'KNC',
      logo: 'knc',
      decimals: 18,
    },
    '0x25d887ce7a35172c62febfd67a1856f20faebb00': {
      ticker: 'PEPE',
      logo: 'pepe',
      decimals: 18,
    },
  },
  [Chain.Base]: {
    // Circle canonical USDC on Base (native CCTP issuance, not bridged).
    // Was missing here while every other major EVM chain ships its USDC,
    // so swaps to Base USDC fell through to the coingecko source and the
    // app flagged the canonical stablecoin as "unverified token". (QA-SWAP-2)
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
    '0x6b9bb36519538e0C073894E964E90172E1c0B41F': {
      ticker: 'WEWE',
      logo: 'wewe',
      decimals: 18,
    },
    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb': {
      ticker: 'DAI',
      logo: 'dai',
      decimals: 18,
      priceProviderId: 'dai',
    },
    '0x820C137fa70C8691f0e44dC420a5e53c168921Dc': {
      ticker: 'USDS',
      logo: 'usds',
      decimals: 18,
      priceProviderId: 'usds',
    },
    '0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c': {
      ticker: 'rETH',
      logo: 'reth',
      decimals: 18,
      priceProviderId: 'reth',
    },
    '0x2416092f143378750bb29b79eD961ab195CcEea5': {
      ticker: 'ezETH',
      logo: 'ezeth',
      decimals: 18,
      priceProviderId: 'ezeth',
    },
    '0x4c5d8A75F3762c1561D96f177694f67378705E98': {
      ticker: 'PYTH',
      logo: 'pyth',
      decimals: 6,
      priceProviderId: 'pyth-network',
    },
    '0xB0fFa8000886e57F86dd5264b9582b2Ad87b2b91': {
      ticker: 'W',
      logo: 'w',
      decimals: 18,
      priceProviderId: 'w',
    },
    '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22': {
      ticker: 'cbETH',
      logo: 'cbeth',
      decimals: 18,
      priceProviderId: 'cbETH',
    },
    '0x22e6966B799c4D5B13BE962E1D117b56327FDa66': {
      ticker: 'SNX',
      logo: 'snx',
      decimals: 18,
      priceProviderId: 'havven',
    },
  },
  [Chain.Arbitrum]: {
    '0x912ce59144191c1204e64559fe8253a0e49e6548': {
      ticker: 'ARB',
      logo: 'arb',
      decimals: 18,
      priceProviderId: 'arbitrum',
    },
    '0x429fEd88f10285E61b12BDF00848315fbDfCC341': {
      ticker: 'TGT',
      logo: 'tgt',
      decimals: 18,
      priceProviderId: 'thorwallet',
    },
    '0xf929de51D91C77E42f5090069E0AD7A09e513c73': {
      ticker: 'FOX',
      logo: 'fox',
      decimals: 18,
      priceProviderId: 'shapeshift-fox-token',
    },
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9': {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
      priceProviderId: 'tether',
    },
    '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8': {
      ticker: 'USDC.e',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
    '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': {
      ticker: 'WBTC',
      logo: 'wbtc',
      decimals: 8,
      priceProviderId: 'wrapped-bitcoin',
    },
    '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4': {
      ticker: 'LINK',
      logo: 'link',
      decimals: 18,
      priceProviderId: 'chainlink',
    },
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1': {
      ticker: 'DAI',
      logo: 'dai',
      decimals: 18,
      priceProviderId: 'dai',
    },
    '0x6491c05A82219b8D1479057361ff1654749b876b': {
      ticker: 'USDS',
      logo: 'usds',
      decimals: 18,
      priceProviderId: 'usds',
    },
    '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0': {
      ticker: 'UNI',
      logo: 'uni',
      decimals: 18,
      priceProviderId: 'uniswap',
    },
    '0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00': {
      ticker: 'PEPE',
      logo: 'pepe',
      decimals: 18,
      priceProviderId: 'pepe',
    },
    '0x9623063377AD1B27544C965cCd7342f7EA7e88C7': {
      ticker: 'GRT',
      logo: 'grt',
      decimals: 18,
      priceProviderId: 'the-graph',
    },
    '0x2416092f143378750bb29b79eD961ab195CcEea5': {
      ticker: 'ezETH',
      logo: 'ezeth',
      decimals: 18,
      priceProviderId: 'ezETH',
    },
    '0xE4D5c6aE46ADFAF04313081e8C0052A30b6Dd724': {
      ticker: 'PYTH',
      logo: 'pyth',
      decimals: 6,
      priceProviderId: 'pyth-network',
    },
    '0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60': {
      ticker: 'LDO',
      logo: 'ldo',
      decimals: 18,
      priceProviderId: 'lido-dao',
    },
  },
  [Chain.Optimism]: {
    '0x4200000000000000000000000000000000000042': {
      ticker: 'OP',
      logo: 'optimism',
      decimals: 18,
    },
    '0xf1a0da3367bc7aa04f8d94ba57b862ff37ced174': {
      ticker: 'FOX',
      logo: 'fox',
      decimals: 18,
    },
    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58': {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
    },
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
    },
    '0x7F5c764cBc14f9669B88837ca1490cCa17c31607': {
      ticker: 'USDC.e',
      logo: 'usdc',
      decimals: 6,
    },
    '0x68f180fcCe6836688e9084f035309E29Bf0A2095': {
      ticker: 'WBTC',
      logo: 'wbtc',
      decimals: 8,
    },
    '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6': {
      ticker: 'LINK',
      logo: 'link',
      decimals: 18,
    },
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1': {
      ticker: 'DAI',
      logo: 'dai',
      decimals: 18,
    },
    '0x2416092f143378750bb29b79eD961ab195CcEea5': {
      ticker: 'ezETH',
      logo: 'ezeth',
      decimals: 18,
    },
    '0x99C59ACeBFEF3BBFB7129DC90D1a11DB0E91187f': {
      ticker: 'PYTH',
      logo: 'pyth',
      decimals: 6,
      priceProviderId: 'pyth-network',
    },
    '0xFdb794692724153d1488CcdBE0C56c252596735F': {
      ticker: 'LDO',
      logo: 'ldo',
      decimals: 18,
    },
  },
  [Chain.Polygon]: {
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619': {
      ticker: 'WETH',
      logo: 'weth',
      decimals: 18,
    },
    '0x65a05db8322701724c197af82c9cae41195b0aa8': {
      ticker: 'FOX',
      logo: 'fox',
      decimals: 18,
    },
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F': {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
    },
    '0x3BA4c387f786bFEE076A58914F5Bd38d668B42c3': {
      ticker: 'BNB',
      logo: 'bsc',
      decimals: 18,
    },
    '0xd93f7E271cB87c23AaA73edC008A79646d1F9912': {
      ticker: 'SOL',
      logo: 'solana',
      decimals: 9,
    },
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
    },
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174': {
      ticker: 'USDC.e',
      logo: 'usdc',
      decimals: 6,
    },
    '0xdAb529f40E671A1D4bF91361c21bf9f0C9712ab7': {
      ticker: 'BUSD',
      logo: 'busd',
      decimals: 18,
    },
    '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6': {
      ticker: 'WBTC',
      logo: 'wbtc',
      decimals: 8,
    },
    '0x2C89bbc92BD86F8075d1DEcc58C7F4E0107f286b': {
      ticker: 'AVAX',
      logo: 'avax',
      decimals: 18,
    },
    '0x6f8a06447Ff6FcF75d803135a7de15CE88C1d4ec': {
      ticker: 'SHIB',
      logo: 'shib',
      decimals: 18,
    },
    '0xb0897686c545045aFc77CF20eC7A532E3120E0F1': {
      ticker: 'LINK',
      logo: 'link',
      decimals: 18,
    },
  },
  [Chain.Blast]: {
    '0x4300000000000000000000000000000000000004': {
      ticker: 'WETH',
      logo: 'weth',
      decimals: 18,
      priceProviderId: 'ethereum',
    },
    '0xF7bc58b8D8f97ADC129cfC4c9f45Ce3C0E1D2692': {
      ticker: 'WBTC',
      logo: 'wbtc',
      decimals: 8,
    },
    '0x4300000000000000000000000000000000000003': {
      ticker: 'USDB',
      logo: 'usdb',
      decimals: 18,
      priceProviderId: 'usdb',
    },
    '0xb1a5700fA2358173Fe465e6eA4Ff52E36e88E2ad': {
      ticker: 'BLAST',
      logo: 'blast',
      decimals: 18,
    },
    '0x76DA31D7C9CbEAE102aff34D3398bC450c8374c1': {
      ticker: 'MIM',
      logo: 'mim',
      decimals: 18,
    },
    '0x9e20461bc2c4c980f62f1B279D71734207a6A356': {
      ticker: 'OMNI',
      logo: 'omni',
      decimals: 18,
    },
    '0x47C337Bd5b9344a6F3D6f58C474D9D8cd419D8cA': {
      ticker: 'DACKIE',
      logo: 'dackie',
      decimals: 18,
    },
  },
  [Chain.Zksync]: {
    '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
    '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4': {
      ticker: 'USDC.e',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
    '0x5A7d6A42eA5632bD2A2e8D5eAEb7bA7e7Eaf3E': {
      ticker: 'ZK',
      logo: 'zk',
      decimals: 18,
      priceProviderId: 'zksync',
    },
  },
  [Chain.Robinhood]: {
    '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168': {
      ticker: 'USDG',
      logo: 'usdg',
      decimals: 6,
      priceProviderId: 'global-dollar',
    },
    '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34': {
      ticker: 'USDe',
      logo: 'usde',
      decimals: 18,
      priceProviderId: 'ethena-usde',
    },
    '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73': {
      ticker: 'WETH',
      logo: 'weth',
      decimals: 18,
      priceProviderId: 'weth',
    },
    '0x492641F648a4986844848E0beFE66D14817bCE34': {
      ticker: 'LINK',
      logo: 'link',
      decimals: 18,
      priceProviderId: 'chainlink',
    },
    '0x521Cf887E6531c6F667b5BC4D896E5d9bfE8EB2E': {
      ticker: 'AAOI',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x521cf887e6531c6f667b5bc4d896e5d9bfe8eb2e.png',
      decimals: 18,
    },
    '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9': {
      ticker: 'AAPL',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xaf3d76f1834a1d425780943c99ea8a608f8a93f9.png',
      decimals: 18,
    },
    '0x36046893810a7E7fCE501229d57dc3FC8c8716d0': {
      ticker: 'AMAT',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x36046893810a7e7fce501229d57dc3fc8c8716d0.png',
      decimals: 18,
    },
    '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC': {
      ticker: 'AMD',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x86923f96303d656e4aa86d9d42d1e57ad2023fdc.png',
      decimals: 18,
    },
    '0x12f190a9F9d7D37a250758b26824B97CE941bF54': {
      ticker: 'AMZN',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x12f190a9f9d7d37a250758b26824b97ce941bf54.png',
      decimals: 18,
    },
    '0xb8DBf92F9741c9ac1c32115E78581f23509916FD': {
      ticker: 'APLD',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xb8dbf92f9741c9ac1c32115e78581f23509916fd.png',
      decimals: 18,
    },
    '0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA': {
      ticker: 'ASML',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x47f93d52cbec7c6d2cfc080e154002370a60daea.png',
      decimals: 18,
    },
    '0x1AF6446f07eb1d97c546AFC8c9544cBDF3AD5137': {
      ticker: 'ASTS',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x1af6446f07eb1d97c546afc8c9544cbdf3ad5137.png',
      decimals: 18,
    },
    '0x156E175DD063a8cE274C50654eF40e0032b3fbcF': {
      ticker: 'AVGO',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x156e175dd063a8ce274c50654ef40e0032b3fbcf.png',
      decimals: 18,
    },
    '0x4D21483a44Bf67a86b77E3dA301411880797D452': {
      ticker: 'BA',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x4d21483a44bf67a86b77e3da301411880797d452.png',
      decimals: 18,
    },
    '0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4': {
      ticker: 'BABA',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xad25ac6c84d497db898fa1e8387bf6af3532a1c4.png',
      decimals: 18,
    },
    '0x822CC93fFD030293E9842c30BBD678F530701867': {
      ticker: 'BE',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x822cc93ffd030293e9842c30bbd678f530701867.png',
      decimals: 18,
    },
    '0x5c90450Bbb4273D7b2f17CF6917AEB237A569679': {
      ticker: 'CBRS',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x5c90450bbb4273d7b2f17cf6917aeb237a569679.png',
      decimals: 18,
    },
    '0x9651342CeA770aE9a2969Ba2A52611523146aef9': {
      ticker: 'CCL',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x9651342cea770ae9a2969ba2a52611523146aef9.png',
      decimals: 18,
    },
    '0x8cF07C5A878945185d327aAa6e33FAa95F95e7bF': {
      ticker: 'CELH',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x8cf07c5a878945185d327aaa6e33faa95f95e7bf.png',
      decimals: 18,
    },
    '0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3': {
      ticker: 'CLSK',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xcbb95bbf36099d34da091dc6fa6f49efa257cee3.png',
      decimals: 18,
    },
    '0x6330D8C3178a418788dF01a47479c0ce7CCF450b': {
      ticker: 'COIN',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x6330d8c3178a418788df01a47479c0ce7ccf450b.png',
      decimals: 18,
    },
    '0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2': {
      ticker: 'COST',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x4ea005168d7f09a7a0ba9d1def21a479950e44c2.png',
      decimals: 18,
    },
    '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5': {
      ticker: 'CRCL',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5.png',
      decimals: 18,
    },
    '0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931': {
      ticker: 'CRWD',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xea72ecca2d0f6bfa1394dbbcff85b52cd4233931.png',
      decimals: 18,
    },
    '0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3': {
      ticker: 'CRWV',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x5f10a1c971b69e47e059e1dc91901b59b3fb49c3.png',
      decimals: 18,
    },
    '0x27c99fBde9D0d2AA4f4Bfb4943f237843DdF6958': {
      ticker: 'DDOG',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x27c99fbde9d0d2aa4f4bfb4943f237843ddf6958.png',
      decimals: 18,
    },
    '0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd': {
      ticker: 'DELL',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x941ae714ec6d8130c7b75d67160ca08f1e7d11dd.png',
      decimals: 18,
    },
    '0x39EC44Bee4F6A116c6F9B8De566848a985C53C60': {
      ticker: 'ELF',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x39ec44bee4f6a116c6f9b8de566848a985c53c60.png',
      decimals: 18,
    },
    '0x7f0aBeF0C07280F82c6a08ead09dEd6BAE2C13Fc': {
      ticker: 'EWY',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x7f0abef0c07280f82c6a08ead09ded6bae2c13fc.png',
      decimals: 18,
    },
    '0x25C288E6D899b9BC30160965aD9644c67e73bE0C': {
      ticker: 'F',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x25c288e6d899b9bc30160965ad9644c67e73be0c.png',
      decimals: 18,
    },
    '0x282e87451E10fA6679BC7D76C69BE44cD3fC777C': {
      ticker: 'FLNC',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x282e87451e10fa6679bc7d76c69be44cd3fc777c.png',
      decimals: 18,
    },
    '0xeB30663bDFf0622Ef4e4E5cBb4E975F19f33f51D': {
      ticker: 'FUTU',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xeb30663bdff0622ef4e4e5cbb4e975f19f33f51d.png',
      decimals: 18,
    },
    '0x7c04E6A3368F2A1DE3874f0e80d2e0A1a9915da6': {
      ticker: 'GLW',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x7c04e6a3368f2a1de3874f0e80d2e0a1a9915da6.png',
      decimals: 18,
    },
    '0x1b0E319c6A659F002271B69dB8A7df2F911c153E': {
      ticker: 'GME',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x1b0e319c6a659f002271b69db8a7df2f911c153e.png',
      decimals: 18,
    },
    '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3': {
      ticker: 'GOOGL',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3.png',
      decimals: 18,
    },
    '0xf1953DAB6FaD537488d5A022361FfAa8B4c95eC6': {
      ticker: 'INOD',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xf1953dab6fad537488d5a022361ffaa8b4c95ec6.png',
      decimals: 18,
    },
    '0xc72b96e0E48ecd4DC75E1e45396e26300BC39681': {
      ticker: 'INTC',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xc72b96e0e48ecd4dc75e1e45396e26300bc39681.png',
      decimals: 18,
    },
    '0x56d23beE5f41A7120170b0c603Dae30128e460e9': {
      ticker: 'INTU',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x56d23bee5f41a7120170b0c603dae30128e460e9.png',
      decimals: 18,
    },
    '0x558378E000D634A36593E338eBacdd6207640EfE': {
      ticker: 'IONQ',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x558378e000d634a36593e338ebacdd6207640efe.png',
      decimals: 18,
    },
    '0xF0AB0c93bE6F41369d302e55db1A96b3c430212D': {
      ticker: 'IREN',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xf0ab0c93be6f41369d302e55db1a96b3c430212d.png',
      decimals: 18,
    },
    '0x8eF20885F94e3D9bc7eB3080279188Bd5ED7c08C': {
      ticker: 'LITE',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x8ef20885f94e3d9bc7eb3080279188bd5ed7c08c.png',
      decimals: 18,
    },
    '0x8005d266423c7ea827372c9c864491e5786600ea': {
      ticker: 'LLY',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x8005d266423c7ea827372c9c864491e5786600ea.png',
      decimals: 18,
    },
    '0x4e62068525Ab11FE768e29dfD00ef909B9803016': {
      ticker: 'LULU',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x4e62068525ab11fe768e29dfd00ef909b9803016.png',
      decimals: 18,
    },
    '0xa5D4968421bA94814Be3B136b15cf422101aC1a3': {
      ticker: 'LUNR',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xa5d4968421ba94814be3b136b15cf422101ac1a3.png',
      decimals: 18,
    },
    '0xDdf2266b79abf0B48898959B0ed6E6adf512be74': {
      ticker: 'MDB',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xddf2266b79abf0b48898959b0ed6e6adf512be74.png',
      decimals: 18,
    },
    '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35': {
      ticker: 'META',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xc0d6457c16cc70d6790dd43521c899c87ce02f35.png',
      decimals: 18,
    },
    '0x62fd0668e10D8B72339BE2DCF7643001688ff13B': {
      ticker: 'MRVL',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x62fd0668e10d8b72339be2dcf7643001688ff13b.png',
      decimals: 18,
    },
    '0xe93237C50D904957Cf27E7B1133b510C669c2e74': {
      ticker: 'MSFT',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xe93237c50d904957cf27e7b1133b510c669c2e74.png',
      decimals: 18,
    },
    '0xec262a75e413fAfD0dF80480274532C79D42da09': {
      ticker: 'MSTR',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xec262a75e413fafd0df80480274532c79d42da09.png',
      decimals: 18,
    },
    '0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD': {
      ticker: 'MU',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xff080c8ce2e5feadaca0da81314ae59d232d4afd.png',
      decimals: 18,
    },
    '0x48961813349333209994750ffA89b3c5C22eC969': {
      ticker: 'MXL',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x48961813349333209994750ffa89b3c5c22ec969.png',
      decimals: 18,
    },
    '0x9D9c6684F596F66a64C030B93A886D51Fd4D7931': {
      ticker: 'NBIS',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x9d9c6684f596f66a64c030b93a886d51fd4d7931.png',
      decimals: 18,
    },
    '0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8': {
      ticker: 'NFLX',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xe0444ef8bf4ed74f74fd73686e2ddf4c1c5591e8.png',
      decimals: 18,
    },
    '0xBEF75684C43c4ea7BD18Dd532a2244674Ee8b926': {
      ticker: 'NNE',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xbef75684c43c4ea7bd18dd532a2244674ee8b926.png',
      decimals: 18,
    },
    '0x0C3260aF4B8f13a69c4c2dFb84fD667890CDFa14': {
      ticker: 'NOW',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x0c3260af4b8f13a69c4c2dfb84fd667890cdfa14.png',
      decimals: 18,
    },
    '0x408c14038a04f7bD235329E26d2bf569ee20e250': {
      ticker: 'NU',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x408c14038a04f7bd235329e26d2bf569ee20e250.png',
      decimals: 18,
    },
    '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC': {
      ticker: 'NVDA',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec.png',
      decimals: 18,
    },
    '0xbE6702d7b70315376dC48a3293f24f0982F86386': {
      ticker: 'NVTS',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xbe6702d7b70315376dc48a3293f24f0982f86386.png',
      decimals: 18,
    },
    '0xb0992820E760d836549ba69BC7598b4af75dEE03': {
      ticker: 'ORCL',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xb0992820e760d836549ba69bc7598b4af75dee03.png',
      decimals: 18,
    },
    '0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D': {
      ticker: 'P',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x1cdad396db64bda184d5182a97dd9b3c62100b7d.png',
      decimals: 18,
    },
    '0x9b23573b156B52565012F5cE02CDF60AFBaa70Be': {
      ticker: 'PENG',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x9b23573b156b52565012f5ce02cdf60afbaa70be.png',
      decimals: 18,
    },
    '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A': {
      ticker: 'PLTR',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a.png',
      decimals: 18,
    },
    '0xcf6B2D875361be807EAfa57458c80f28521F9333': {
      ticker: 'POET',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xcf6b2d875361be807eafa57458c80f28521f9333.png',
      decimals: 18,
    },
    '0x4189F0c66EBBB0bfeF1C31f763131361EF32f77C': {
      ticker: 'PR',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x4189f0c66ebbb0bfef1c31f763131361ef32f77c.png',
      decimals: 18,
    },
    '0xC583c60aeF9Dc401Da72cEC1B404743a93cea1Cc': {
      ticker: 'QBTS',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xc583c60aef9dc401da72cec1b404743a93cea1cc.png',
      decimals: 18,
    },
    '0x0f17206447090e464C277571124dD2688E48AEA9': {
      ticker: 'QCOM',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x0f17206447090e464c277571124dd2688e48aea9.png',
      decimals: 18,
    },
    '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68': {
      ticker: 'QQQ',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xd5f3879160bc7c32ebb4dc785f8a4f505888de68.png',
      decimals: 18,
    },
    '0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4': {
      ticker: 'QUBT',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x59818904ab4ce163b3ce4ffb64f2d6ca02c434b4.png',
      decimals: 18,
    },
    '0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8': {
      ticker: 'RBLX',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8.png',
      decimals: 18,
    },
    '0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C': {
      ticker: 'RDDT',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x05b37fb53a299a1b874a619e1c4c404d52c36f4c.png',
      decimals: 18,
    },
    '0x92Ef19E82bD8fF36661DE838D5eaE7e5CEF0EfFE': {
      ticker: 'RDW',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x92ef19e82bd8ff36661de838d5eae7e5cef0effe.png',
      decimals: 18,
    },
    '0x284358abc07F9359f19f4b5b4aC91901Be2597Ba': {
      ticker: 'RGTI',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x284358abc07f9359f19f4b5b4ac91901be2597ba.png',
      decimals: 18,
    },
    '0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B': {
      ticker: 'RIVN',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xb1bf26c1d20ff267a4f93550d1e0d06ac40a114b.png',
      decimals: 18,
    },
    '0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2': {
      ticker: 'RKLB',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x3b14c39e89d60d627b42a1a4ca45b5bb45fc12e2.png',
      decimals: 18,
    },
    '0x95052ddcd5DC25641657424A8Cf04834997E1730': {
      ticker: 'SATS',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x95052ddcd5dc25641657424a8cf04834997e1730.png',
      decimals: 18,
    },
    '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5': {
      ticker: 'SGOV',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x92fd66527192e3e61d4ddd13322aa222de86f9b5.png',
      decimals: 18,
    },
    '0xF53F66751B1Eff985311b693531E3290F600c410': {
      ticker: 'SHOP',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xf53f66751b1eff985311b693531e3290f600c410.png',
      decimals: 18,
    },
    '0x84CAb63bc87912E71ad199ff14A0bA45de68FeF8': {
      ticker: 'SKHY',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x84cab63bc87912e71ad199ff14a0ba45de68fef8.png',
      decimals: 18,
    },
    '0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f': {
      ticker: 'SLV',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x411efb0e7f985935daec3d4c3ebaea0d0ad7d89f.png',
      decimals: 18,
    },
    '0xc01aA1fECeC0605b13bc84874ff7256C0f5F562a': {
      ticker: 'SMCI',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xc01aa1fecec0605b13bc84874ff7256c0f5f562a.png',
      decimals: 18,
    },
    '0xB90A19fF0Af67f7779afF50A882A9CfF42446400': {
      ticker: 'SNDK',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xb90a19ff0af67f7779aff50a882a9cff42446400.png',
      decimals: 18,
    },
    '0x98E75885157C80992A8D41b696D8c9C6Fb30A926': {
      ticker: 'SOFI',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x98e75885157c80992a8d41b696d8c9c6fb30a926.png',
      decimals: 18,
    },
    '0x75742c18BC1f1C5c5f448f4C9D9C6F66dafAAa38': {
      ticker: 'SOXX',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x75742c18bc1f1c5c5f448f4c9d9c6f66dafaaa38.png',
      decimals: 18,
    },
    '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa': {
      ticker: 'SPCX',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea.png',
      decimals: 18,
    },
    '0xAd622320e520de39e72d41EF07438C3Fd3354875': {
      ticker: 'SPMO',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xad622320e520de39e72d41ef07438c3fd3354875.png',
      decimals: 18,
    },
    '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C': {
      ticker: 'SPY',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x117cc2133c37b721f49de2a7a74833232b3b4c0c.png',
      decimals: 18,
    },
    '0x89776d4Cd68193597A2fC132cfaC1fDe36CCeA8a': {
      ticker: 'TSEM',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x89776d4cd68193597a2fc132cfac1fde36ccea8a.png',
      decimals: 18,
    },
    '0x322F0929c4625eD5bAd873c95208D54E1c003b2d': {
      ticker: 'TSLA',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x322f0929c4625ed5bad873c95208d54e1c003b2d.png',
      decimals: 18,
    },
    '0x58FfE4a942d3885bAa22D7520691F611EF09e7AA': {
      ticker: 'TSM',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x58ffe4a942d3885baa22d7520691f611ef09e7aa.png',
      decimals: 18,
    },
    '0x5e81213613b6B86EaB4c6c50d718d34359459786': {
      ticker: 'TTWO',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x5e81213613b6b86eab4c6c50d718d34359459786.png',
      decimals: 18,
    },
    '0x0E6e67Ba88e7b5d9B67636A215c76779B948dE79': {
      ticker: 'UMC',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x0e6e67ba88e7b5d9b67636a215c76779b948de79.png',
      decimals: 18,
    },
    '0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2': {
      ticker: 'UPS',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xf23250dac154d05bb671cb0d0ebef3c635c79ce2.png',
      decimals: 18,
    },
    '0xd917B029C761D264c6A312BBbcDA868658eF86a6': {
      ticker: 'USAR',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xd917b029c761d264c6a312bbbcda868658ef86a6.png',
      decimals: 18,
    },
    '0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344': {
      ticker: 'USO',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344.png',
      decimals: 18,
    },
    '0x82DA4646242e1D962e96e932269Dc644c94a9CaA': {
      ticker: 'WDAY',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x82da4646242e1d962e96e932269dc644c94a9caa.png',
      decimals: 18,
    },
    '0x15Cd20759CE7F3285c29A319dE2D1A2e098c6f43': {
      ticker: 'XLK',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x15cd20759ce7f3285c29a319de2d1a2e098c6f43.png',
      decimals: 18,
    },
    '0xA8eB3BCcbf2017eE7CBfb652eB51CF2E1B153289': {
      ticker: 'XNDU',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xa8eb3bccbf2017ee7cbfb652eb51cf2e1b153289.png',
      decimals: 18,
    },
    '0xf9B46d3D1B22199D4D1025a9cEDB540A33F1a2d5': {
      ticker: 'XOM',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0xf9b46d3d1b22199d4d1025a9cedb540a33f1a2d5.png',
      decimals: 18,
    },
    '0x44c4F142009036cF477eD2d09932051843137CF1': {
      ticker: 'ZM',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x44c4f142009036cf477ed2d09932051843137cf1.png',
      decimals: 18,
    },
    '0x7dc013eB55e436f30d7ED1AFE4E36d6e45e3c3f7': {
      ticker: 'ZS',
      logo: 'https://cdn.robinhood.com/ncw_assets/logos/0x7dc013eb55e436f30d7ed1afe4e36d6e45e3c3f7.png',
      decimals: 18,
    },
  },
  [Chain.Mantle]: {
    '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE': {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
      priceProviderId: 'tether',
    },
    '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
  },
  [Chain.Hyperliquid]: {
    '0xfD739d4e423301CE9385c1fb8850539D657C296D': {
      ticker: 'kHYPE',
      logo: 'khype.webp',
      decimals: 18,
      priceProviderId: 'kinetic-staked-hype',
    },
    '0x94e8396e0869c9F2200760aF0621aFd240E1CF38': {
      ticker: 'wstHYPE',
      logo: 'wsthype.webp',
      decimals: 18,
      priceProviderId: 'staked-hype-shares',
    },
    '0x5555555555555555555555555555555555555555': {
      ticker: 'WHYPE',
      logo: 'hyperliquid.webp',
      decimals: 18,
      priceProviderId: 'wrapped-hype',
    },
    '0x3B4575E689DEd21CAAD31d64C4df1f10F3B2CedF': {
      ticker: 'UFART',
      logo: 'ufart.webp',
      decimals: 6,
      priceProviderId: 'unit-fartcoin',
    },
    '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb': {
      ticker: 'USDT0',
      logo: 'usdt0.webp',
      decimals: 6,
      priceProviderId: 'usdt0',
    },
    '0x9BA2EDc44E0A4632EB4723E81d4142353e1bB160': {
      ticker: 'vkHYPE',
      logo: 'vkhype.webp',
      decimals: 18,
      priceProviderId: 'kinetiq-earn-vault',
    },
    '0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463': {
      ticker: 'UBTC',
      logo: 'btc',
      decimals: 8,
      priceProviderId: 'unit-bitcoin',
    },
    '0x8888888FdAAc0E7CF8C6523c8955bF7954c216fa': {
      ticker: 'vHYPE',
      logo: 'vhype.webp',
      decimals: 18,
      priceProviderId: 'ventuals-vhype',
    },
    '0xb88339CB7199b77E23DB6E890353E22632Ba630f': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
  },
  [Chain.Polkadot]: {
    // Polkadot Asset Hub (parachain 1000) — pallet_assets tokens.
    // asset_id is used as the token identifier instead of a contract address.
    // Decimals verified live via state_getStorage on Assets.Metadata at 2026-05-25.
    // On-chain symbol for 1984 is "USDt" but we normalise to "USDT" for consistency.
    '1984': {
      ticker: 'USDT',
      logo: 'usdt',
      decimals: 6,
      // NOTE: CoinGecko's 'tether' coin doesn't list polkadot-asset-hub in its
      // platforms map (only Ethereum/Solana/Tron/TON/Near/etc). Price still resolves
      // correctly via /simple/price?ids=tether but any future platform-verification
      // logic (e.g. checking coin.platforms['polkadot-asset-hub']) will find nothing
      // and should special-case this entry.
      priceProviderId: 'tether',
    },
    '1337': {
      ticker: 'USDC',
      logo: 'usdc',
      decimals: 6,
      priceProviderId: 'usd-coin',
    },
  },
  [Chain.Ripple]: Object.fromEntries(rippleKnownIssuedTokens.map(token => [token.id, omit(token, 'id', 'chain')])),
  ...knownCosmosTokens,
}

export const knownTokens = makeRecord(Object.values(Chain), chain => {
  const result: KnownCoin[] = []

  const tokens = leanTokens[chain]
  if (tokens) {
    Object.entries(tokens).forEach(([id, token]) => {
      result.push({
        ...token,
        chain,
        id,
      })
    })
  }

  return result
})

type KnownIndex = Record<Chain, Record<string, KnownCoin>>

export const knownTokensIndex: KnownIndex = makeRecord(Object.values(Chain), chain => {
  const byId: Record<string, KnownCoin> = {}
  for (const coin of knownTokens[chain] ?? []) {
    if (!coin.id) continue
    byId[coin.id.toLowerCase()] = coin
  }
  return byId
})
