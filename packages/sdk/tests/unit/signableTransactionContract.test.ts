import { Chain } from '@vultisig/core-chain/Chain'
import type { ChainKind } from '@vultisig/core-chain/ChainKind'
import { describe, expect, it } from 'vitest'

import type {
  SignableActionV1,
  SignableApprovalInputV1,
  SignableDecodedTransactionV1,
  SignableDisplayBoundsV1,
  SignableTransactionDecoderV1,
  SignableTransactionEnvelopeV1,
  SignableTransactionFixtureV1,
  SignableUnsignedPayloadV1,
  SignableVerificationIssueCodeV1,
} from '../../src/signable-transaction'
import {
  canonicalizeSignableTransactionValue,
  createSignableTransactionEnvelopeV1,
  getSignableApprovalBindingKeyV1,
  hashSignableDisplayV1,
  hashSignableTransactionValue,
  hashSignableUnsignedPayloadV1,
  runSignableTransactionFixtureV1,
  signableActionV1Schema,
  SignableTransactionContractError,
  signableTransactionEnvelopeV1Schema,
  verifySignableTransactionEnvelopeV1,
} from '../../src/signable-transaction'

const chain = Chain.Ethereum
const sourceAccount = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const approval = { id: 'approval-1447', nonce: 'nonce-1' }
const expiresAt = '2030-01-01T00:00:00.000Z'
const now = '2029-12-31T00:00:00.000Z'
const nativeAsset = { chain, symbol: 'ETH' }
const tokenAsset = { chain, symbol: 'USDC', tokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }

const payload = (value: string): SignableUnsignedPayloadV1 => ({ encoding: 'hex', value })
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const sendAction = (overrides: Partial<Extract<SignableActionV1, { type: 'send' }>> = {}) => ({
  type: 'send' as const,
  chain,
  sourceAccount,
  recipient,
  asset: nativeAsset,
  amount: '1000000000000000',
  memo: 'invoice-42',
  ...overrides,
})

const decoded = (
  actions: SignableActionV1[],
  constraints: Extract<SignableDecodedTransactionV1, { status: 'decoded' }>['constraints'] = {}
): Extract<SignableDecodedTransactionV1, { status: 'decoded' }> => ({ status: 'decoded', actions, constraints })

const decoderFor = (
  result: SignableDecodedTransactionV1,
  family: ChainKind = 'evm'
): SignableTransactionDecoderV1<SignableDecodedTransactionV1> => ({
  family,
  decode: () => result,
  normalize: native => native,
})

const createEnvelope = async (input: {
  action?: SignableActionV1
  intent?: SignableTransactionEnvelopeV1['intent']
  unsignedPayload?: SignableUnsignedPayloadV1
  decodedResult?: SignableDecodedTransactionV1
  bounds?: SignableDisplayBoundsV1
  approval?: SignableApprovalInputV1
}) => {
  const action = input.action ?? sendAction()
  const decodedResult = input.decodedResult ?? decoded([action])
  return createSignableTransactionEnvelopeV1({
    intent: input.intent ?? action.type,
    chain,
    sourceAccount,
    unsignedPayload: input.unsignedPayload ?? payload('01020304'),
    expiresAt,
    approval: input.approval ?? approval,
    decoder: decoderFor(decodedResult),
    displayBounds: input.bounds,
  })
}

const makeFixture = (input: {
  name: string
  envelope: SignableTransactionEnvelopeV1
  candidatePayload?: SignableUnsignedPayloadV1
  candidateDecoded?: SignableDecodedTransactionV1
  mutateDisplay?: (display: SignableTransactionEnvelopeV1['display']) => void
  now?: string
  approval?: SignableTransactionEnvelopeV1['approval']
  consumedApprovalBindings?: string[]
  valid: boolean
  issueCodes?: SignableVerificationIssueCodeV1[]
}): SignableTransactionFixtureV1 => {
  const renderedDisplay = clone(input.envelope.display)
  input.mutateDisplay?.(renderedDisplay)
  return {
    version: 1,
    name: input.name,
    envelope: input.envelope,
    candidate: {
      unsignedPayload: input.candidatePayload ?? input.envelope.unsignedPayload,
      decoded:
        input.candidateDecoded ??
        decoded(input.envelope.actions, {
          ...(input.envelope.display.constraints.fee
            ? {
                fee: {
                  asset: input.envelope.display.constraints.fee.asset,
                  value: input.envelope.display.constraints.fee.value,
                },
              }
            : {}),
          ...(input.envelope.display.constraints.slippageBps
            ? { slippageBps: input.envelope.display.constraints.slippageBps.value }
            : {}),
        }),
      renderedDisplay,
      approval: input.approval ?? input.envelope.approval,
      now: input.now ?? now,
      consumedApprovalBindings: input.consumedApprovalBindings,
    },
    expected: { valid: input.valid, issueCodes: input.issueCodes ?? [] },
  }
}

describe('signable transaction contract v1', () => {
  it('canonicalizes object keys and hashes deterministically', () => {
    const first = { z: ['2', '1'], a: { y: 'yes', x: 1 } }
    const second = { a: { x: 1, y: 'yes' }, z: ['2', '1'] }
    expect(canonicalizeSignableTransactionValue(first)).toBe('{"a":{"x":1,"y":"yes"},"z":["2","1"]}')
    expect(hashSignableTransactionValue(first)).toBe(hashSignableTransactionValue(second))
    expect(() => canonicalizeSignableTransactionValue({ amount: 1.5 })).toThrow(/safe integers/)
  })

  it('creates a versioned envelope with payload, display and approval bindings', async () => {
    const envelope = await createEnvelope({})
    expect(signableTransactionEnvelopeV1Schema.parse(envelope)).toEqual(envelope)
    expect(envelope.version).toBe(1)
    expect(envelope.payloadHash).toBe(hashSignableUnsignedPayloadV1(envelope.unsignedPayload))
    expect(envelope.displayHash).toBe(hashSignableDisplayV1(envelope.display))
    expect(envelope.approval.bindingHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(envelope.display.materialFields).toEqual(
      expect.arrayContaining([
        { key: 'chain', value: chain },
        { key: 'sourceAccount', value: sourceAccount },
        { key: 'actions.0.recipient', value: recipient },
        { key: 'actions.0.amount', value: '1000000000000000' },
        { key: 'actions.0.memo', value: 'invoice-42' },
      ])
    )
  })

  it('hashes exact payload bytes consistently across canonical encodings', () => {
    expect(hashSignableUnsignedPayloadV1({ encoding: 'hex', value: '01020304' })).toBe(
      hashSignableUnsignedPayloadV1({ encoding: 'base64', value: 'AQIDBA==' })
    )
    expect(hashSignableUnsignedPayloadV1({ encoding: 'utf8', value: 'send' })).toBe(
      hashSignableUnsignedPayloadV1({ encoding: 'hex', value: '73656e64' })
    )
    expect(() => hashSignableUnsignedPayloadV1({ encoding: 'base64', value: 'AB==' })).toThrow(
      /zero unused padding bits/
    )
    expect(() => hashSignableUnsignedPayloadV1({ encoding: 'base64', value: 'AAB=' })).toThrow(
      /zero unused padding bits/
    )
  })

  it('normalizes optional undefined fields and verifies SDK and JSON round trips', async () => {
    const envelope = await createEnvelope({ action: sendAction({ memo: undefined }) })
    expect(Object.hasOwn(envelope.actions[0]!, 'memo')).toBe(false)

    for (const candidate of [envelope, JSON.parse(JSON.stringify(envelope)) as SignableTransactionEnvelopeV1]) {
      const result = await verifySignableTransactionEnvelopeV1({
        envelope: candidate,
        unsignedPayload: candidate.unsignedPayload,
        renderedDisplay: candidate.display,
        approval: candidate.approval,
        now,
        decoder: decoderFor(decoded([sendAction({ memo: undefined })])),
        reserveApprovalBinding: () => true,
      })
      expect(result).toMatchObject({ valid: true })
    }
  })

  it('fails closed for unknown semantics and a wrong decoder family', async () => {
    await expect(
      createEnvelope({ decodedResult: { status: 'unknown', reason: 'unrecognized nested call' } })
    ).rejects.toMatchObject({ code: 'unknown-semantics' } satisfies Partial<SignableTransactionContractError>)

    await expect(
      createSignableTransactionEnvelopeV1({
        intent: 'send',
        chain,
        sourceAccount,
        unsignedPayload: payload('0102'),
        expiresAt,
        approval,
        decoder: decoderFor(decoded([sendAction()]), 'solana'),
      })
    ).rejects.toMatchObject({ code: 'chain-family-mismatch' } satisfies Partial<SignableTransactionContractError>)
  })

  it('defines every canonical action and its required material fields', () => {
    const actions: SignableActionV1[] = [
      sendAction(),
      { ...sendAction(), type: 'token-send', asset: tokenAsset },
      { type: 'approval', chain, sourceAccount, asset: tokenAsset, spender: recipient, allowance: '1000' },
      {
        type: 'swap',
        chain,
        sourceAccount,
        recipient,
        fromAsset: nativeAsset,
        toAsset: tokenAsset,
        amount: '1000',
        minOut: '900',
        memo: 'swap:1',
      },
      {
        type: 'contract-call',
        chain,
        sourceAccount,
        contract: recipient,
        calldataHash: hashSignableTransactionValue({ calldata: '0x1234' }),
        value: '0',
        method: 'claim()',
      },
      { type: 'deposit', chain, sourceAccount, protocol: 'thorchain', recipient, asset: nativeAsset, amount: '100' },
      {
        type: 'withdraw',
        chain,
        sourceAccount,
        protocol: 'lending-v1',
        recipient,
        asset: tokenAsset,
        amount: '50',
        positionId: 'position-1',
        minOut: '49',
      },
      {
        type: 'redeem',
        chain,
        sourceAccount,
        protocol: 'vault-v1',
        recipient,
        asset: tokenAsset,
        amount: '25',
        positionId: 'shares-1',
        minOut: '24',
      },
    ]
    actions.forEach(action => expect(signableActionV1Schema.parse(action)).toEqual(action))

    expect(() => signableActionV1Schema.parse({ ...actions[0], asset: tokenAsset })).toThrow()
    expect(() => signableActionV1Schema.parse({ ...actions[1], asset: nativeAsset })).toThrow()
    expect(() => signableActionV1Schema.parse({ ...actions[2], allowance: undefined })).toThrow()
    expect(() => signableActionV1Schema.parse({ ...actions[3], minOut: undefined })).toThrow()
  })

  it('runs shared pass/reject fixtures for every required divergence fence', async () => {
    const sendEnvelope = await createEnvelope({})
    const approvalAction: SignableActionV1 = {
      type: 'approval',
      chain,
      sourceAccount,
      asset: tokenAsset,
      spender: recipient,
      allowance: '1000',
    }
    const approvalEnvelope = await createEnvelope({
      action: approvalAction,
      unsignedPayload: payload('0506'),
    })
    const swapAction: SignableActionV1 = {
      type: 'swap',
      chain,
      sourceAccount,
      recipient,
      fromAsset: nativeAsset,
      toAsset: tokenAsset,
      amount: '1000',
      minOut: '900',
      memo: 'swap:fixture',
    }
    const swapEnvelope = await createEnvelope({
      action: swapAction,
      unsignedPayload: payload('0708'),
      decodedResult: decoded([swapAction], { slippageBps: '75' }),
      bounds: { slippageBps: { min: '50', max: '100' } },
    })
    const feeEnvelope = await createEnvelope({
      decodedResult: decoded([sendAction()], { fee: { asset: nativeAsset, value: '15' } }),
      bounds: { fee: { min: '10', max: '20' } },
    })
    const expiryChangedEnvelope = clone(sendEnvelope)
    expiryChangedEnvelope.expiresAt = '2030-01-01T00:00:01.000Z'

    const fixtures: SignableTransactionFixtureV1[] = [
      makeFixture({ name: 'exact payload and display pass', envelope: sendEnvelope, valid: true }),
      makeFixture({
        name: 'payload divergence',
        envelope: sendEnvelope,
        candidatePayload: payload('01020305'),
        valid: false,
        issueCodes: ['payload-divergence'],
      }),
      makeFixture({
        name: 'payload transport encoding divergence',
        envelope: sendEnvelope,
        candidatePayload: { encoding: 'base64', value: 'AQIDBA==' },
        valid: false,
        issueCodes: ['payload-divergence'],
      }),
      makeFixture({
        name: 'display divergence',
        envelope: sendEnvelope,
        mutateDisplay: display => {
          display.materialFields.find(field => field.key === 'actions.0.amount')!.value = '2000000000000000'
        },
        valid: false,
        issueCodes: ['display-divergence'],
      }),
      makeFixture({
        name: 'recipient change',
        envelope: sendEnvelope,
        candidatePayload: payload('01020306'),
        candidateDecoded: decoded([sendAction({ recipient: '0x3333333333333333333333333333333333333333' })]),
        valid: false,
        issueCodes: ['payload-divergence', 'decoded-actions-divergence'],
      }),
      makeFixture({
        name: 'amount change',
        envelope: sendEnvelope,
        candidatePayload: payload('01020307'),
        candidateDecoded: decoded([sendAction({ amount: '1000000000000001' })]),
        valid: false,
        issueCodes: ['payload-divergence', 'decoded-actions-divergence'],
      }),
      makeFixture({
        name: 'memo change',
        envelope: sendEnvelope,
        candidatePayload: payload('01020308'),
        candidateDecoded: decoded([sendAction({ memo: 'invoice-43' })]),
        valid: false,
        issueCodes: ['payload-divergence', 'decoded-actions-divergence'],
      }),
      makeFixture({
        name: 'spender change',
        envelope: approvalEnvelope,
        candidatePayload: payload('0507'),
        candidateDecoded: decoded([{ ...approvalAction, spender: '0x4444444444444444444444444444444444444444' }]),
        valid: false,
        issueCodes: ['payload-divergence', 'decoded-actions-divergence'],
      }),
      makeFixture({
        name: 'allowance change',
        envelope: approvalEnvelope,
        candidatePayload: payload('0508'),
        candidateDecoded: decoded([{ ...approvalAction, allowance: '1001' }]),
        valid: false,
        issueCodes: ['payload-divergence', 'decoded-actions-divergence'],
      }),
      makeFixture({
        name: 'minimum output change',
        envelope: swapEnvelope,
        candidatePayload: payload('0709'),
        candidateDecoded: decoded([{ ...swapAction, minOut: '899' }], { slippageBps: '75' }),
        valid: false,
        issueCodes: ['payload-divergence', 'decoded-actions-divergence'],
      }),
      makeFixture({
        name: 'expired approval',
        envelope: sendEnvelope,
        now: expiresAt,
        valid: false,
        issueCodes: ['expired'],
      }),
      makeFixture({
        name: 'expiry field change',
        envelope: expiryChangedEnvelope,
        valid: false,
        issueCodes: ['approval-binding-divergence'],
      }),
      makeFixture({
        name: 'wrong source account',
        envelope: sendEnvelope,
        candidatePayload: payload('01020309'),
        candidateDecoded: decoded([sendAction({ sourceAccount: '0x5555555555555555555555555555555555555555' })]),
        valid: false,
        issueCodes: ['payload-divergence', 'decoded-actions-divergence'],
      }),
      makeFixture({
        name: 'wrong chain',
        envelope: sendEnvelope,
        candidatePayload: payload('0102030c'),
        candidateDecoded: decoded([sendAction({ chain: Chain.BSC, asset: { chain: Chain.BSC, symbol: 'BNB' } })]),
        valid: false,
        issueCodes: ['payload-divergence', 'decoded-actions-divergence'],
      }),
      makeFixture({
        name: 'approval binding digest change',
        envelope: sendEnvelope,
        approval: { ...sendEnvelope.approval, bindingHash: `sha256:${'0'.repeat(64)}` },
        valid: false,
        issueCodes: ['approval-divergence'],
      }),
      makeFixture({
        name: 'approval replay',
        envelope: sendEnvelope,
        consumedApprovalBindings: [getSignableApprovalBindingKeyV1(approval)],
        valid: false,
        issueCodes: ['approval-replay'],
      }),
      makeFixture({
        name: 'hidden batch action',
        envelope: sendEnvelope,
        candidatePayload: payload('0102030a'),
        candidateDecoded: decoded([
          sendAction(),
          sendAction({ recipient: sourceAccount, amount: '1', memo: undefined }),
        ]),
        valid: false,
        issueCodes: ['payload-divergence', 'decoded-actions-divergence'],
      }),
      makeFixture({
        name: 'unknown candidate semantics',
        envelope: sendEnvelope,
        candidatePayload: payload('0102030b'),
        candidateDecoded: { status: 'unknown', reason: 'unrecognized nested call' },
        valid: false,
        issueCodes: ['payload-divergence', 'unknown-semantics'],
      }),
      makeFixture({ name: 'explicit slippage bound pass', envelope: swapEnvelope, valid: true }),
      makeFixture({
        name: 'slippage value change inside displayed bound',
        envelope: swapEnvelope,
        candidateDecoded: decoded([swapAction], { slippageBps: '80' }),
        mutateDisplay: display => {
          display.constraints.slippageBps!.value = '80'
        },
        valid: true,
      }),
      makeFixture({
        name: 'fee value change inside displayed bound',
        envelope: feeEnvelope,
        candidateDecoded: decoded([sendAction()], { fee: { asset: nativeAsset, value: '16' } }),
        mutateDisplay: display => {
          display.constraints.fee!.value = '16'
        },
        valid: true,
      }),
      makeFixture({
        name: 'slippage outside displayed bound',
        envelope: swapEnvelope,
        candidatePayload: payload('070a'),
        candidateDecoded: decoded([swapAction], { slippageBps: '101' }),
        valid: false,
        issueCodes: ['payload-divergence', 'constraint-out-of-bounds'],
      }),
    ]

    for (const fixture of fixtures) {
      const result = await runSignableTransactionFixtureV1(fixture, 'evm')
      expect(result.valid, fixture.name).toBe(fixture.expected.valid)
      if (!result.valid) {
        const codes = result.issues.map(issue => issue.code)
        fixture.expected.issueCodes.forEach(code => expect(codes, fixture.name).toContain(code))
      }
    }
  })

  it('requires decoded fee/slippage values to stay inside explicit displayed bounds', async () => {
    const withFee = decoded([sendAction()], { fee: { asset: nativeAsset, value: '15' } })
    const envelope = await createEnvelope({ decodedResult: withFee, bounds: { fee: { min: '10', max: '20' } } })
    expect(envelope.display.constraints.fee).toMatchObject({ value: '15', min: '10', max: '20' })

    await expect(
      createEnvelope({ decodedResult: withFee, bounds: { fee: { min: '16', max: '20' } } })
    ).rejects.toMatchObject({ code: 'constraint-out-of-bounds' } satisfies Partial<SignableTransactionContractError>)
  })

  it('rejects a recomputed candidate envelope when its trusted approval receipt did not change', async () => {
    const original = await createEnvelope({})
    const tampered = clone(original)
    tampered.unsignedPayload = payload('0a0b0c0d')
    tampered.payloadHash = hashSignableUnsignedPayloadV1(tampered.unsignedPayload)
    tampered.approval.bindingHash = hashSignableTransactionValue({
      version: 1,
      approvalId: tampered.approval.id,
      approvalNonce: tampered.approval.nonce,
      payloadHash: tampered.payloadHash,
      displayHash: tampered.displayHash,
      expiresAt: tampered.expiresAt,
      intent: tampered.intent,
      chain: tampered.chain,
      sourceAccount: tampered.sourceAccount,
    })

    const result = await verifySignableTransactionEnvelopeV1({
      envelope: tampered,
      unsignedPayload: tampered.unsignedPayload,
      renderedDisplay: tampered.display,
      approval: original.approval,
      now,
      decoder: decoderFor(decoded(tampered.actions)),
      reserveApprovalBinding: () => true,
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues.map(issue => issue.code)).toContain('approval-divergence')
  })

  it('returns fail-closed results for malformed candidate payloads and displays', async () => {
    const envelope = await createEnvelope({})
    const result = await verifySignableTransactionEnvelopeV1({
      envelope,
      unsignedPayload: { encoding: 'hex', value: '0x01' },
      renderedDisplay: { materialFields: [], constraints: {} },
      approval: envelope.approval,
      now,
      decoder: decoderFor(decoded(envelope.actions)),
      reserveApprovalBinding: () => true,
    })
    expect(result).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'payload-divergence' }),
        expect.objectContaining({ code: 'display-divergence' }),
      ]),
    })
  })

  it('returns fail-closed results for malformed trusted inputs', async () => {
    const envelope = await createEnvelope({})
    const malformedApproval = await verifySignableTransactionEnvelopeV1({
      envelope,
      unsignedPayload: envelope.unsignedPayload,
      renderedDisplay: envelope.display,
      approval: null,
      now: null,
      decoder: decoderFor(decoded(envelope.actions)),
      reserveApprovalBinding: null,
    } as never)

    expect(malformedApproval).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid-verification-input' })]),
    })

    const nonCanonicalNow = await verifySignableTransactionEnvelopeV1({
      envelope,
      unsignedPayload: envelope.unsignedPayload,
      renderedDisplay: envelope.display,
      approval: envelope.approval,
      now: '0',
      decoder: decoderFor(decoded(envelope.actions)),
      reserveApprovalBinding: () => true,
    })
    expect(nonCanonicalNow).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid-verification-input' })]),
    })
  })

  it('atomically reserves the approval before returning valid', async () => {
    const envelope = await createEnvelope({})
    const reserved = new Set<string>()
    const reserveApprovalBinding = (key: string) => {
      if (reserved.has(key)) return false
      reserved.add(key)
      return true
    }
    const verify = () =>
      verifySignableTransactionEnvelopeV1({
        envelope,
        unsignedPayload: envelope.unsignedPayload,
        renderedDisplay: envelope.display,
        approval: envelope.approval,
        now,
        decoder: decoderFor(decoded(envelope.actions)),
        reserveApprovalBinding,
      })

    const results = await Promise.all([verify(), verify()])
    expect(results.filter(result => result.valid)).toHaveLength(1)
    expect(results.filter(result => !result.valid)).toEqual([
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: 'approval-replay' })]),
      }),
    ])

    const freshEnvelope = await createEnvelope({
      approval: { id: ' trimmed-id ', nonce: ' trimmed-nonce ' },
    })
    expect(freshEnvelope.approval).toMatchObject({ id: 'trimmed-id', nonce: 'trimmed-nonce' })
    const malformedReservation = await verifySignableTransactionEnvelopeV1({
      envelope: freshEnvelope,
      unsignedPayload: freshEnvelope.unsignedPayload,
      renderedDisplay: freshEnvelope.display,
      approval: freshEnvelope.approval,
      now,
      decoder: decoderFor(decoded(freshEnvelope.actions)),
      reserveApprovalBinding: (() => 'false') as never,
    })
    expect(malformedReservation).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'approval-reservation-failed' })]),
    })
  })
})
