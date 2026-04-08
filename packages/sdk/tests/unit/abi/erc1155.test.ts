import { encodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'

import { ERC20_ABI, ERC1155_ABI } from '../../../src/abi'

describe('ERC-1155 ABI', () => {
  it('should export setApprovalForAll', () => {
    const fn = ERC1155_ABI.find(f => f.name === 'setApprovalForAll')
    expect(fn).toBeDefined()
    expect(fn!.inputs).toHaveLength(2)
    expect(fn!.inputs[0].type).toBe('address')
    expect(fn!.inputs[1].type).toBe('bool')
  })

  it('should export isApprovedForAll', () => {
    const fn = ERC1155_ABI.find(f => f.name === 'isApprovedForAll')
    expect(fn).toBeDefined()
    expect(fn!.inputs).toHaveLength(2)
  })

  it('should export balanceOf with two args (account + tokenId)', () => {
    const fn = ERC1155_ABI.find(f => f.name === 'balanceOf')
    expect(fn).toBeDefined()
    // ERC-1155 balanceOf takes (address, uint256) — NOT just (address) like ERC-20
    expect(fn!.inputs).toHaveLength(2)
    expect(fn!.inputs[0].type).toBe('address')
    expect(fn!.inputs[1].type).toBe('uint256')
  })

  it('should encode setApprovalForAll via viem', () => {
    const operator = '0xC5d563A36AE78145C45a50134d48A1215220f80a'
    const calldata = encodeFunctionData({
      abi: ERC1155_ABI,
      functionName: 'setApprovalForAll',
      args: [operator, true],
    })

    // Should produce valid hex calldata
    expect(calldata).toMatch(/^0x/)
    // setApprovalForAll selector = 0xa22cb465
    expect(calldata.startsWith('0xa22cb465')).toBe(true)
  })

  it('should encode safeTransferFrom via viem', () => {
    const calldata = encodeFunctionData({
      abi: ERC1155_ABI,
      functionName: 'safeTransferFrom',
      args: [
        '0x0000000000000000000000000000000000000001', // from
        '0x0000000000000000000000000000000000000002', // to
        1n, // tokenId
        100n, // amount
        '0x', // data
      ],
    })

    expect(calldata).toMatch(/^0x/)
  })
})

describe('ERC-20 ABI (re-exported from viem)', () => {
  it('should export approve', () => {
    const fn = ERC20_ABI.find(f => 'name' in f && f.name === 'approve')
    expect(fn).toBeDefined()
  })

  it('should export balanceOf with single arg', () => {
    const fn = ERC20_ABI.find(f => 'name' in f && f.name === 'balanceOf' && f.type === 'function')
    expect(fn).toBeDefined()
    expect((fn as any).inputs).toHaveLength(1)
  })

  it('should encode approve via viem', () => {
    const calldata = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: ['0x0000000000000000000000000000000000000001', 2n ** 256n - 1n],
    })

    expect(calldata).toMatch(/^0x/)
    // approve selector = 0x095ea7b3
    expect(calldata.startsWith('0x095ea7b3')).toBe(true)
  })
})

describe('ERC-20 vs ERC-1155 balanceOf difference', () => {
  it('ERC-20 balanceOf has 1 input, ERC-1155 has 2', () => {
    const erc20BalanceOf = ERC20_ABI.find(f => 'name' in f && f.name === 'balanceOf' && f.type === 'function')!
    const erc1155BalanceOf = ERC1155_ABI.find(f => f.name === 'balanceOf')!

    // This is exactly the bug from the postmortem: calling ERC-20's balanceOf(address)
    // on an ERC-1155 contract reverts because ERC-1155 requires balanceOf(address, uint256)
    expect((erc20BalanceOf as any).inputs).toHaveLength(1)
    expect(erc1155BalanceOf.inputs).toHaveLength(2)
  })
})
