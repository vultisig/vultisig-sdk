import type { ConversationMessage } from './types'

export function resolveResponseText(streamResult: { fullText: string; message: ConversationMessage | null }): string {
  const messageContent = streamResult.message?.content || ''
  return messageContent || streamResult.fullText
}
