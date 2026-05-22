// Station LI.FI integrator config.
//
// DO NOT USE until the integrator name is confirmed by the LI.FI portal.
// `station-v0` has been requested but portal approval is still pending
// (see spec: https://gist.githubusercontent.com/realpaaao/2a3fbb3dee9b01e96a06b481ea174bb8/raw).
//
// Once confirmed, update integratorName, remove this comment, and merge
// the draft PR (vultisig/vultisig-sdk — [DO NOT MERGE] feat(lifi): station config).
export const stationLifiConfig = {
  // TBD: replace with the confirmed integrator name from the LI.FI portal
  integratorName: 'station-v0',
  feeRecipientAddress: '0x649E1289fD780C2F9A3D27476511283EB0d0076D',
}
