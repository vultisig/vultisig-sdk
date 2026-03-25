import { Keyshare, SignSession } from '@lib/mldsa/vs_wasm'
import { base64Encode } from '@lib/utils/base64Encode'

import { getMessageHash } from '../getMessageHash'
import { deleteMpcRelayMessage } from '../message/relay/delete'
import { getMpcRelayMessages } from '../message/relay/get'
import { sendMpcRelayMessage } from '../message/relay/send'
import { fromMpcServerMessage, toMpcServerMessage } from '../message/server'
import { waitForSetupMessage } from '../message/setup/get'
import { uploadMpcSetupMessage } from '../message/setup/upload'
import { sleep } from '../sleep'
import { initializeMldsaLib } from './initializeMldsa'

const mldsaLevel = 44

export type MldsaKeysignResult = {
  msg: string
  signature: string
}

export class MldsaKeysign {
  private readonly keysignCommittee: string[]
  private readonly serverURL: string
  private readonly sessionId: string
  private readonly localPartyId: string
  private readonly messagesToSign: string[]
  private readonly keyShareBase64: string
  private readonly hexEncryptionKey: string
  private readonly chainPath: string
  private readonly isInitiatingDevice: boolean
  private readonly timeoutMs: number

  private isKeysignComplete: boolean = false
  private sequenceNo: number = 0
  private cache: Record<string, string> = {}

  constructor(input: {
    keysignCommittee: string[]
    serverURL: string
    sessionId: string
    localPartyId: string
    messagesToSign: string[]
    keyShareBase64: string
    hexEncryptionKey: string
    chainPath: string
    isInitiatingDevice: boolean
    timeoutMs?: number
  }) {
    this.keysignCommittee = input.keysignCommittee
    this.serverURL = input.serverURL
    this.sessionId = input.sessionId
    this.localPartyId = input.localPartyId
    this.messagesToSign = input.messagesToSign
    this.keyShareBase64 = input.keyShareBase64
    this.hexEncryptionKey = input.hexEncryptionKey
    this.chainPath = input.chainPath
    this.isInitiatingDevice = input.isInitiatingDevice
    this.timeoutMs = input.timeoutMs ?? 60000
  }

  private async processOutbound(
    session: SignSession,
    messageId: string
  ): Promise<boolean> {
    try {
      const message = session.outputMessage()
      if (message === undefined) {
        if (this.isKeysignComplete) {
          return true
        }
        await sleep(100)
        return this.processOutbound(session, messageId)
      }

      const body = toMpcServerMessage(message.body, this.hexEncryptionKey)

      message.receivers.forEach(receiver => {
        sendMpcRelayMessage({
          serverUrl: this.serverURL,
          sessionId: this.sessionId,
          message: {
            session_id: this.sessionId,
            from: this.localPartyId,
            to: [receiver],
            body,
            hash: getMessageHash(base64Encode(message.body)),
            sequence_no: this.sequenceNo,
          },
          messageId,
        })
        this.sequenceNo++
      })

      await sleep(100)
      return this.processOutbound(session, messageId)
    } catch (error) {
      console.error('MLDSA keysign processOutbound error:', error)
      await sleep(100)
      return this.processOutbound(session, messageId)
    }
  }

  private async processInbound(
    session: SignSession,
    start: number,
    messageId: string
  ): Promise<boolean> {
    try {
      const parsedMessages = await getMpcRelayMessages({
        serverUrl: this.serverURL,
        localPartyId: this.localPartyId,
        sessionId: this.sessionId,
        messageId,
      })

      if (parsedMessages.length === 0) {
        await sleep(100)
        return this.processInbound(session, start, messageId)
      }

      for (const msg of parsedMessages) {
        const cacheKey = `${msg.session_id}-${msg.from}-${msg.hash}`
        if (this.cache[cacheKey]) {
          continue
        }

        const decryptedMessage = fromMpcServerMessage(
          msg.body,
          this.hexEncryptionKey
        )
        const isFinish = session.inputMessage(decryptedMessage)
        if (isFinish) {
          await sleep(1000)
          this.isKeysignComplete = true
          return true
        }

        this.cache[cacheKey] = ''
        await deleteMpcRelayMessage({
          serverUrl: this.serverURL,
          localPartyId: this.localPartyId,
          sessionId: this.sessionId,
          messageHash: msg.hash,
          messageId,
        })
      }

      const elapsed = Date.now() - start
      if (elapsed > this.timeoutMs * 2) {
        this.isKeysignComplete = true
        return false
      }

      await sleep(100)
      return this.processInbound(session, start, messageId)
    } catch (error) {
      console.error('MLDSA keysign processInbound error:', error)
      await sleep(100)
      return this.processInbound(session, start, messageId)
    }
  }

  private async signMessage(messageHex: string): Promise<MldsaKeysignResult> {
    this.isKeysignComplete = false
    this.cache = {}
    this.sequenceNo = 0

    const keyShare = Keyshare.fromBytes(Buffer.from(this.keyShareBase64, 'base64'))
    const keyId = keyShare.keyId()
    const messageHash = Buffer.from(messageHex, 'hex')
    const messageId = getMessageHash(messageHex)

    let setupMessage: Uint8Array

    if (this.isInitiatingDevice) {
      setupMessage = SignSession.setup(
        mldsaLevel,
        keyId,
        this.chainPath,
        messageHash,
        this.keysignCommittee
      )

      const encryptedSetupMsg = toMpcServerMessage(
        setupMessage,
        this.hexEncryptionKey
      )
      await uploadMpcSetupMessage({
        serverUrl: this.serverURL,
        message: encryptedSetupMsg,
        sessionId: this.sessionId,
        messageId,
      })
    } else {
      const encodedEncryptedSetupMsg = await waitForSetupMessage({
        serverUrl: this.serverURL,
        sessionId: this.sessionId,
        messageId,
      })
      setupMessage = fromMpcServerMessage(
        encodedEncryptedSetupMsg,
        this.hexEncryptionKey
      )
    }

    const session = new SignSession(setupMessage, this.localPartyId, keyShare)

    const start = Date.now()
    const outbound = this.processOutbound(session, messageId)
    const inbound = this.processInbound(session, start, messageId)
    const [, inboundResult] = await Promise.all([outbound, inbound])

    if (inboundResult) {
      const signature = session.finish()
      return {
        msg: messageHex,
        signature: Buffer.from(signature).toString('hex'),
      }
    }

    throw new Error(`MLDSA keysign failed for message: ${messageHex}`)
  }

  public async startKeysign(): Promise<MldsaKeysignResult[]> {
    await initializeMldsaLib()

    const results: MldsaKeysignResult[] = []
    for (const msg of this.messagesToSign) {
      const result = await this.signMessage(msg)
      results.push(result)
    }
    return results
  }

  public async startKeysignWithRetry(
    maxRetries = 3
  ): Promise<MldsaKeysignResult[]> {
    await initializeMldsaLib()

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.startKeysign()
      } catch (error) {
        console.error(`MLDSA keysign attempt ${i} failed:`, error)
      }
    }
    throw new Error(`MLDSA keysign failed after ${maxRetries} attempts`)
  }
}
