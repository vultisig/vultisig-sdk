export const startsWithBytes = (value: Uint8Array, prefix: Uint8Array): boolean => {
  if (value.length < prefix.length) {
    return false
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (value[index] !== prefix[index]) {
      return false
    }
  }

  return true
}
