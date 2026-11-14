import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { KeysignPayload, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmationRequiredError } from '../../core/errors'

const printResult = vi.fn()
const qrGenerate = vi.fn()
const confirmTransaction = vi.fn()
vi.mock('qrcode-terminal', () => ({ default: { generate: (...args: unknown[]) => qrGenerate(...args) } }))
// JSON output mode: isJsonOutput true, isSilent false, as the real output module reports it.
vi.mock('../../lib/output', () => ({
  createSpinner: () => ({ succeed: vi.fn(), start: vi.fn(), stop: vi.fn(), fail: vi.fn(), text: '' }),
  info: vi.fn(),
  warn: vi.fn(),
  isNonInteractive: () => false,
  isJsonOutput: () => true,
  isSilent: () => false,
  outputJson: vi.fn(),
  printResult: (...args: unknown[]) => printResult(...args),
}))
vi.mock('../../ui', () => ({
  confirmTransaction: (...args: unknown[]) => confirmTransaction(...args),
  displayTransactionPreview: vi.fn(),
  displayTransactionResult: vi.fn(),
}))

import { sendTransaction } from '../transaction'

const QR = 'vultisig://vultisig.com?type=SignTransaction&jsonData=abc'

const payload = {
  coin: { isNativeToken: true, ticker: 'ETH', contractAddress: '', chain: 'Ethereum', address: '0xsender' },
  toAddress: '0xrecipient',
  toAmount: '1000000000000000000',
} as unknown as KeysignPayload

type Handler = (event: unknown) => void

/**
 * A vault whose send() announces the QR the way SecureVault.sign() does: by
 * emitting on itself. on() returns an unsubscribe function like the SDK's
 * EventEmitter, and `registered` records every event a listener was added for.
 */
function makeVault(type: 'secure' | 'fast', id: string) {
  const listeners = new Map<string, Set<Handler>>()
  const registered: string[] = []
  const emit = (event: string, data: unknown) => {
    for (const handler of [...(listeners.get(event) ?? [])]) handler(data)
  }
  const vault = {
    type,
    id,
    name: id,
    isEncrypted: false,
    isUnlocked: () => true,
    publicKeys: { ecdsa: '0xEcdsaOwnerPubKey', eddsa: '' },
    on: (event: string, handler: Handler) => {
      registered.push(event)
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
      return () => listeners.get(event)?.delete(handler)
    },
    removeAllListeners: (event: string) => {
      listeners.delete(event)
      return vault
    },
    send: async (params: { dryRun?: boolean; chain: Chain }) => {
      if (params.dryRun) return { dryRun: true as const, fee: '0.001', total: '1', keysignPayload: payload }
      emit('qrCodeReady', { qrPayload: QR, sessionId: 's1' })
      emit('deviceJoined', { deviceId: 'phone', totalJoined: 2, required: 2 })
      return { dryRun: false as const, txHash: '0xmock', chain: params.chain }
    },
    gas: async () => ({ estimatedFee: '0.000015' }),
    balance: async () => ({ symbol: 'ETH', decimals: 18, formattedAmount: '10' }),
    address: async () => '0xsender',
    listeners,
    registered,
  }
  return vault
}

const send = (vault: ReturnType<typeof makeVault>, yes = true) =>
  sendTransaction(vault as unknown as VaultBase, { chain: Chain.Ethereum, to: '0xrecipient', amount: '1', yes })

const qrLines = () => printResult.mock.calls.map(([line]) => String(line)).filter(line => line.includes(QR))

describe('send on a secure vault renders the keysign QR', () => {
  beforeEach(() => {
    printResult.mockClear()
    qrGenerate.mockClear()
    confirmTransaction.mockReset()
    process.env.VULTISIG_BROADCAST_JOURNAL_PATH = join(mkdtempSync(join(tmpdir(), 'send-qr-')), 'journal.json')
  })

  it('prints exactly one QR line per send, as a JSON object with qrPayload', async () => {
    const vault = makeVault('secure', 'secure-vault-fixture')
    const result = await send(vault)
    expect(result).toMatchObject({ txHash: '0xmock' })
    const lines = qrLines()
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({ qrPayload: QR })
    expect(qrGenerate).not.toHaveBeenCalled()
  })

  it('removes only its own listeners, leaving ones registered before the send', async () => {
    const vault = makeVault('secure', 'secure-vault-fixture')
    const ownerQr = vi.fn()
    const ownerJoined = vi.fn()
    vault.on('qrCodeReady', ownerQr)
    vault.on('deviceJoined', ownerJoined)

    await send(vault)

    expect(vault.registered.filter(event => event === 'qrCodeReady')).toHaveLength(2)
    expect(ownerQr).toHaveBeenCalledOnce()
    expect([...vault.listeners.get('qrCodeReady')!]).toEqual([ownerQr])
    expect([...vault.listeners.get('deviceJoined')!]).toEqual([ownerJoined])
    expect(vault.listeners.has('signingProgress')).toBe(false)
  })

  it('registers no QR or device-join listener for a fast vault and leaves existing ones alone', async () => {
    const vault = makeVault('fast', 'fast-vault-fixture')
    const ownerQr = vi.fn()
    const ownerJoined = vi.fn()
    vault.on('qrCodeReady', ownerQr)
    vault.on('deviceJoined', ownerJoined)
    vault.registered.length = 0

    await send(vault)

    expect(vault.registered).not.toContain('qrCodeReady')
    expect(vault.registered).not.toContain('deviceJoined')
    expect(qrLines()).toHaveLength(0)
    expect([...vault.listeners.get('qrCodeReady')!]).toEqual([ownerQr])
    expect([...vault.listeners.get('deviceJoined')!]).toEqual([ownerJoined])
  })

  it('registers no QR listener when the confirmation is refused before broadcast', async () => {
    confirmTransaction.mockResolvedValue(false)
    const vault = makeVault('secure', 'secure-vault-fixture')

    await expect(send(vault, false)).rejects.toBeInstanceOf(ConfirmationRequiredError)

    expect(vault.registered).not.toContain('qrCodeReady')
    expect(vault.registered).not.toContain('deviceJoined')
    expect(qrLines()).toHaveLength(0)
  })
})
