export function match<T extends string | number | symbol, V>(value: T, handlers: { [key in T]: () => V }): V {
  const handler = handlers[value]

  if (typeof handler !== 'function') {
    throw new Error(`match: no handler for "${String(value)}"`)
  }

  return handler()
}
