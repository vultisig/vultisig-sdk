"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAminoMsgSubmitEvidence = isAminoMsgSubmitEvidence;
exports.createEvidenceAminoConverters = createEvidenceAminoConverters;
function isAminoMsgSubmitEvidence(msg) {
    return msg.type === "cosmos-sdk/MsgSubmitEvidence";
}
function createEvidenceAminoConverters() {
    throw new Error("Not implemented");
}
//# sourceMappingURL=aminomessages.js.map