/** Read the top-level SUN token from JSON already validated by queryTronWithText. */
export const extractTronBalanceSun = (text: string): string => {
  // Strings stay whole, including escaped quotes and property names. Tracking
  // depth prevents nested balances or JSON embedded in strings from matching.
  const tokens = text.match(/"(?:[^"\\]|\\[\s\S])*"|[{}[\]:,]|[^\s{}[\]:,]+/g) ?? []
  let depth = 0
  let balance: string | undefined
  let nestedBalance = false
  const keys = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '{' || token === '[') depth++
    else if (token === '}' || token === ']') depth--
    else if (token.startsWith('"') && tokens[i + 1] === ':') {
      const key = JSON.parse(token) as string
      if (depth !== 1) {
        if (key === 'balance') nestedBalance = true
        continue
      }
      if (keys.has(key)) throw new Error(`Tron account returned duplicate JSON property "${key}"`)
      keys.add(key)
      if (key === 'balance') {
        const value = tokens[i + 2]
        if (!/^(0|[1-9]\d*)$/.test(value)) {
          throw new Error('Tron account returned a malformed SUN balance: expected a nonnegative integer token')
        }
        balance = value
      }
    }
  }
  if (balance === undefined && nestedBalance) {
    throw new Error('Tron account returned only a nested balance, not a top-level SUN balance')
  }
  // Protobuf omits a zero balance; {} is a legitimate absent account.
  return balance ?? '0'
}
