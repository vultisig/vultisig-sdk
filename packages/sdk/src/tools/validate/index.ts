// Recipient sanity (pure format / equality checks: null / self-send / malformed-EVM)
export type { RecipientSanityFlag, RecipientSanityInput, RecipientSanityResult } from './recipientSanity'
export { isMalformedEvmAddress, isNullAddress, isSelfSend, recipientSanity } from './recipientSanity'
