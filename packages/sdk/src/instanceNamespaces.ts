export type VultisigInstanceNamespaces = {
  balance: typeof import('./tools/balance')
  bridge: typeof import('./tools/bridge')
  cosmos: typeof import('./tools/cosmos')
  decode: typeof import('./tools/decode').decode
  gas: typeof import('./tools/gas')
  prep: typeof import('./tools/prep')
  price: typeof import('./tools/price')
  swap: typeof import('./tools/swap')
}

export type VultisigInstanceNamespaceShape = Record<keyof VultisigInstanceNamespaces, object>

const namespacesByConstructor = new WeakMap<object, VultisigInstanceNamespaceShape>()

/** @internal Platform entrypoints register their compatible namespace handles here. */
export const configureVultisigInstanceNamespaces = <T extends VultisigInstanceNamespaceShape>(
  constructor: object,
  namespaces: T
): void => {
  namespacesByConstructor.set(constructor, namespaces)
}

/** @internal Resolve namespaces for the concrete platform class. */
export const getVultisigInstanceNamespaces = <T extends VultisigInstanceNamespaceShape>(instance: object): T => {
  let constructor: object | null = instance.constructor

  while (constructor) {
    const namespaces = namespacesByConstructor.get(constructor)
    if (namespaces) return namespaces as T
    constructor = Object.getPrototypeOf(constructor) as object | null
  }

  throw new Error('Vultisig helper namespaces are unavailable: import Vultisig from a supported SDK entrypoint')
}
