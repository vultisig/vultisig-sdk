export function match<T extends string | number | symbol, V>(value: T, handlers: { [key in T]: () => V }): V {
  // Only an OWN handler is a real match. Without the hasOwnProperty check, a runtime value that
  // collides with an inherited Object.prototype member name ('constructor' / 'toString' / 'valueOf' /
  // 'isPrototypeOf' / 'hasOwnProperty' / …) resolves to that prototype FUNCTION, passes the typeof
  // guard below, and silently dispatches to the wrong "handler" instead of failing closed — the same
  // misroute this guard exists to prevent for an unknown chain/denom/id.
  const handler = Object.prototype.hasOwnProperty.call(handlers, value) ? handlers[value] : undefined

  if (typeof handler !== 'function') {
    throw new Error(`match: no handler for "${String(value)}"`)
  }

  return handler()
}
