/**
 * Shared no-restricted-syntax entries for singleton-bearing MPC packages.
 *
 * Why only `let`:
 *   The original bug (#3777) was a module-level `let engine: ... | null = null`
 *   whose value differed per bundler chunk. Immutable `const` lookup tables
 *   (e.g. `const set = new Set([...])` with no later writes) are not a hazard —
 *   per-chunk copies are semantically identical. Flagging them produced
 *   false-positive refactors with no correctness benefit.
 *
 * The real footgun is mutable module-level state. `let` telegraphs that intent;
 * ban it in these packages and force an explicit opt-out for the rare
 * legitimate case.
 *
 * Opt-out: // eslint-disable-next-line no-restricted-syntax -- vultisig-singleton-ok: <reason>
 */

export const mpcSingletonRestrictedSyntax = [
  {
    selector: 'Program > VariableDeclaration[kind="let"]',
    message:
      'Module-level `let` is disallowed in MPC singleton packages — use runtimeStore() or another safe pattern. ' +
      'To opt out: // eslint-disable-next-line no-restricted-syntax -- vultisig-singleton-ok: <reason>',
  },
  {
    selector: 'Program > ExportNamedDeclaration > VariableDeclaration[kind="let"]',
    message:
      'Module-level `export let` is disallowed in MPC singleton packages — use runtimeStore() or another safe pattern. ' +
      'To opt out: // eslint-disable-next-line no-restricted-syntax -- vultisig-singleton-ok: <reason>',
  },
]
