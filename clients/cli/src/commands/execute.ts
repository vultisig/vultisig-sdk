/**
 * Execute Command - Execute CosmWasm smart contracts
 * 
 * This command enables AI agents and users to execute CosmWasm contracts on
 * Cosmos SDK chains (THORChain, MayaChain, etc.) via MPC signing.
 * 
 * Primary use case: Execute FIN swaps on Rujira DEX
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain, Vultisig } from '@vultisig/sdk'
import qrcode from 'qrcode-terminal'

import type { CommandContext, TransactionResult } from '../core'
import { ensureVaultUnlocked } from '../core'
import { createSpinner, info, isJsonOutput, isSilent, outputJson, printResult, warn } from '../lib/output'
import { confirmTransaction, displayTransactionResult } from '../ui'

/**
 * Parameters for executing a CosmWasm contract
 */
export type ExecuteParams = {
  chain: Chain
  contract: string
  msg: string // JSON string
  funds?: string // Format: "denom:amount,denom2:amount2"
  memo?: string
  yes?: boolean
  password?: string
  signal?: AbortSignal
}

/**
 * Parsed funds from command line
 */
type ParsedFund = {
  denom: string
  amount: string
}

/**
 * Chain-specific configuration for Cosmos chains
 */
const COSMOS_CHAIN_CONFIG: Record<string, { chainId: string; prefix: string; denom: string; gasLimit: string }> = {
  THORChain: {
    chainId: 'thorchain-1',
    prefix: 'thor',
    denom: 'rune',
    gasLimit: '500000',
  },
  MayaChain: {
    chainId: 'mayachain-mainnet-v1',
    prefix: 'maya',
    denom: 'cacao',
    gasLimit: '500000',
  },
}

/**
 * Parse funds string into array of coins
 * Format: "denom:amount" or "denom:amount,denom2:amount2"
 */
function parseFunds(fundsStr?: string): ParsedFund[] {
  if (!fundsStr) return []
  
  return fundsStr.split(',').map(fund => {
    const [denom, amount] = fund.trim().split(':')
    if (!denom || !amount) {
      throw new Error(`Invalid funds format: "${fund}". Expected "denom:amount"`)
    }
    return { denom: denom.toLowerCase(), amount }
  })
}

/**
 * Execute a CosmWasm contract
 */
export async function executeExecute(ctx: CommandContext, params: ExecuteParams): Promise<TransactionResult> {
  const vault = await ctx.ensureActiveVault()

  // Validate chain is supported
  const chainConfig = COSMOS_CHAIN_CONFIG[params.chain]
  if (!chainConfig) {
    throw new Error(`Chain ${params.chain} does not support CosmWasm execute. Supported chains: ${Object.keys(COSMOS_CHAIN_CONFIG).join(', ')}`)
  }

  // Parse and validate message JSON
  let msg: object
  try {
    msg = JSON.parse(params.msg)
  } catch {
    throw new Error(`Invalid JSON message: ${params.msg}`)
  }

  // Parse funds
  const funds = parseFunds(params.funds)

  return executeContractTransaction(vault, params, chainConfig, msg, funds)
}

/**
 * Execute contract transaction with full flow using SignAmino
 */
async function executeContractTransaction(
  vault: VaultBase,
  params: ExecuteParams,
  chainConfig: { chainId: string; prefix: string; denom: string; gasLimit: string },
  msg: object,
  funds: ParsedFund[]
): Promise<TransactionResult> {
  // 1. Prepare transaction
  const prepareSpinner = createSpinner('Preparing contract execution...')

  const address = await vault.address(params.chain)
  
  prepareSpinner.succeed('Transaction prepared')

  // 2. Show preview
  if (!isJsonOutput()) {
    info('\n📝 Contract Execution Preview')
    info('━'.repeat(50))
    info(`Chain:      ${params.chain}`)
    info(`From:       ${address}`)
    info(`Contract:   ${params.contract}`)
    info(`Message:    ${JSON.stringify(msg, null, 2).substring(0, 200)}${JSON.stringify(msg).length > 200 ? '...' : ''}`)
    if (funds.length > 0) {
      info(`Funds:      ${funds.map(f => `${f.amount} ${f.denom}`).join(', ')}`)
    }
    if (params.memo) {
      info(`Memo:       ${params.memo}`)
    }
    info('━'.repeat(50))
  }

  // 3. Confirm with user
  if (!params.yes && !isJsonOutput()) {
    const confirmed = await confirmTransaction()
    if (!confirmed) {
      warn('Transaction cancelled')
      throw new Error('Transaction cancelled by user')
    }
  }

  // Pre-unlock vault
  await ensureVaultUnlocked(vault, params.password)

  // 4. Sign transaction using Vultisig MPC with SignAmino
  const isSecureVault = vault.type === 'secure'
  const signSpinner = createSpinner(isSecureVault ? 'Preparing secure signing session...' : 'Signing transaction...')

  vault.on('signingProgress', ({ step }: any) => {
    signSpinner.text = `${step.message} (${step.progress}%)`
  })

  // Handle secure vault QR code
  if (isSecureVault) {
    vault.on('qrCodeReady', ({ qrPayload }: { qrPayload: string }) => {
      if (isJsonOutput()) {
        printResult(qrPayload)
      } else if (isSilent()) {
        printResult(`QR Payload: ${qrPayload}`)
      } else {
        signSpinner.stop()
        info('\nScan this QR code with your Vultisig mobile app to sign:')
        qrcode.generate(qrPayload, { small: true })
        info(`\nOr use this URL: ${qrPayload}\n`)
        signSpinner.start('Waiting for devices to join signing session...')
      }
    })

    vault.on('deviceJoined', ({ deviceId, totalJoined, required }: { deviceId: string; totalJoined: number; required: number }) => {
      if (!isSilent()) {
        signSpinner.text = `Device joined: ${totalJoined}/${required} (${deviceId})`
      } else if (!isJsonOutput()) {
        printResult(`Device joined: ${totalJoined}/${required}`)
      }
    })
  }

  try {
    // Build coin info for the chain
    const coin = {
      chain: params.chain,
      address,
      decimals: 8, // THORChain uses 8 decimals
      ticker: chainConfig.denom.toUpperCase(),
    }

    // Build MsgExecuteContract in Amino format
    // The type URL follows standard CosmWasm naming convention
    const executeContractMsg = {
      type: 'wasm/MsgExecuteContract',
      value: JSON.stringify({
        sender: address,
        contract: params.contract,
        msg: msg,
        funds: funds.map(f => ({ denom: f.denom, amount: f.amount })),
      }),
    }

    // Build fee (THORChain has zero fees for CosmWasm)
    const fee = {
      amount: [{ denom: chainConfig.denom, amount: '0' }],
      gas: chainConfig.gasLimit,
    }

    // Prepare signing payload using Vultisig SDK's prepareSignAminoTx
    const keysignPayload = await vault.prepareSignAminoTx({
      chain: params.chain,
      coin,
      msgs: [executeContractMsg],
      fee,
      memo: params.memo,
    })

    // Extract message hashes and sign
    const messageHashes = await vault.extractMessageHashes(keysignPayload)

    const signature = await vault.sign(
      {
        transaction: keysignPayload,
        chain: params.chain,
        messageHashes,
      },
      { signal: params.signal }
    )

    signSpinner.succeed('Transaction signed')

    // 5. Broadcast transaction
    const broadcastSpinner = createSpinner('Broadcasting transaction...')

    const txHash = await vault.broadcastTx({
      chain: params.chain,
      keysignPayload,
      signature,
    })

    broadcastSpinner.succeed(`Transaction broadcast: ${txHash}`)

    const result: TransactionResult = {
      txHash,
      chain: params.chain,
      explorerUrl: Vultisig.getTxExplorerUrl(params.chain, txHash),
    }

    // 6. Display result
    if (isJsonOutput()) {
      outputJson(result)
    } else {
      displayTransactionResult(params.chain, txHash)
    }

    return result
  } finally {
    vault.removeAllListeners('signingProgress')
    if (isSecureVault) {
      vault.removeAllListeners('qrCodeReady')
      vault.removeAllListeners('deviceJoined')
    }
  }
}
