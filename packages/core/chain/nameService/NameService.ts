/** Name services a send recipient can be typed as. */
export const nameServices = ['ens', 'thorname', 'mayaname'] as const

/** A name service, identified by the registry its names live in. */
export type NameService = (typeof nameServices)[number]

/** The top-level suffix each name service owns, without the dot. */
export const nameServiceSuffix: Record<NameService, string> = {
  ens: 'eth',
  thorname: 'thor',
  mayaname: 'maya',
}
