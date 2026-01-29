"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAminoMsgUnjail = isAminoMsgUnjail;
exports.createSlashingAminoConverters = createSlashingAminoConverters;
function isAminoMsgUnjail(msg) {
    return msg.type === "cosmos-sdk/MsgUnjail";
}
function createSlashingAminoConverters() {
    throw new Error("Not implemented");
}
//# sourceMappingURL=aminomessages.js.map