import { DaemonManager } from "../daemon/DaemonManager";

export class QuitCommand {
  readonly description = "Gracefully shutdown the daemon";

  async run(): Promise<void> {
    console.log("🛑 Shutting down daemon...");

    const daemonManager = new DaemonManager();
    await daemonManager.sendShutdownSignal();
  }
}
