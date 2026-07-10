import { BuildKeysignPayloadError } from '../error'

export const maxRippleDestinationTag = 0xffffffff

export const getLegacyDestinationTag = (memo: string | undefined): number | undefined => {
  // A legacy tag carrier must be its canonical decimal form. Preserve zero:
  // older SDK/Android builds signed a canonical "0" memo as DestinationTag 0.
  if (!memo || !/^(0|[1-9]\d*)$/.test(memo)) return undefined

  const destinationTag = Number(memo)
  return destinationTag <= maxRippleDestinationTag ? destinationTag : undefined
}

export const validateDestinationTag = (destinationTag: number): number => {
  if (!Number.isInteger(destinationTag) || destinationTag < 1 || destinationTag > maxRippleDestinationTag) {
    throw new BuildKeysignPayloadError(
      'ripple-destination-tag-invalid',
      `Invalid XRP destination tag: expected an integer between 1 and ${maxRippleDestinationTag}`
    )
  }

  return destinationTag
}

export const resolveDestinationTag = ({
  destinationTag,
  memo,
}: {
  destinationTag?: number
  memo?: string
}): number | undefined => {
  const legacyDestinationTag = getLegacyDestinationTag(memo)
  if (destinationTag === undefined) return legacyDestinationTag

  const validDestinationTag = validateDestinationTag(destinationTag)
  if (legacyDestinationTag !== undefined && legacyDestinationTag !== validDestinationTag) {
    throw new BuildKeysignPayloadError(
      'ripple-destination-tag-invalid',
      `Conflicting XRP destination tags: field ${validDestinationTag}, memo ${legacyDestinationTag}`
    )
  }

  return validDestinationTag
}
