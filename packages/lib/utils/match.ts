export function match<T extends string | number | symbol, V>(
  value: T,
  handlers: { [key in T]: () => V }
): V {
  const handler = handlers[value]
  if (!handler) {
    throw new Error(
      `No match handler for: "${String(value)}". Available: [${Object.keys(handlers).join(', ')}]`
    )
  }

  return handler()
}
