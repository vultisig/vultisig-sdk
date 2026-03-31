export type MpcLib = 'GG20' | 'DKLS' | 'KeyImport'

/** Keysign / vault lib type on the wire (includes key-import mode). */
export type KeysignLibType = MpcLib

export const mpcLibOptions = ['GG20', 'DKLS'] as const

export const defaultMpcLib: MpcLib = 'DKLS'
