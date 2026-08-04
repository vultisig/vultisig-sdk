import { Address, beginCell, external, storeMessage } from '@ton/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryUrl } = vi.hoisted(() => ({ mockQueryUrl: vi.fn() }))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: mockQueryUrl }))

import { estimateTonFee } from './api'

const ADDRESS = 'UQAqbua3_0G_7K_jgzhjJceolfT-TONGsY65wUoBUtZinP1w'

const buildExternalMessageBoc = () => {
  const body = beginCell().storeUint(0x12345678, 32).endCell()
  const code = beginCell().storeUint(0xcafe, 16).endCell()
  const data = beginCell().storeUint(0xbeef, 16).endCell()
  const message = beginCell()
    .store(
      storeMessage(
        external({
          to: Address.parse(ADDRESS),
          init: { code, data },
          body,
        })
      )
    )
    .endCell()

  return {
    externalMessageBoc: message.toBoc().toString('base64'),
    body: body.toBoc().toString('base64'),
    code: code.toBoc().toString('base64'),
    data: data.toBoc().toString('base64'),
  }
}

describe('estimateTonFee', () => {
  beforeEach(() => {
    mockQueryUrl.mockReset()
  })

  it('extracts the external body and StateInit, then totals source and destination fees', async () => {
    mockQueryUrl.mockResolvedValue({
      ok: true,
      result: {
        source_fees: { in_fwd_fee: 1, storage_fee: 2, gas_fee: 3, fwd_fee: 4 },
        destination_fees: [
          { in_fwd_fee: '5', storage_fee: '6', gas_fee: '7', fwd_fee: '8' },
          { in_fwd_fee: 9, storage_fee: 10, gas_fee: 11, fwd_fee: 12 },
        ],
      },
    })
    const vector = buildExternalMessageBoc()

    await expect(estimateTonFee({ address: ADDRESS, externalMessageBoc: vector.externalMessageBoc })).resolves.toBe(78n)

    expect(mockQueryUrl).toHaveBeenCalledWith(expect.stringMatching(/\/ton\/v2\/estimateFee$/), {
      body: {
        address: ADDRESS,
        body: vector.body,
        init_code: vector.code,
        init_data: vector.data,
        ignore_chksig: true,
      },
    })
  })

  it('rejects a toncenter error response instead of manufacturing a quote', async () => {
    mockQueryUrl.mockResolvedValue({ ok: false, error: 'LITE_SERVER_NETWORK timeout' })
    const { externalMessageBoc } = buildExternalMessageBoc()

    await expect(estimateTonFee({ address: ADDRESS, externalMessageBoc })).rejects.toThrow(
      /LITE_SERVER_NETWORK timeout/
    )
  })
})
