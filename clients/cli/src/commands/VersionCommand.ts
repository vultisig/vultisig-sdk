export class VersionCommand {
  public readonly description = 'Show version information'

  async run(): Promise<void> {
    console.log('1.0.0')
  }
}
