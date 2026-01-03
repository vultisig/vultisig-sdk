import type {
  IFileAdapter,
  SaveFileOptions,
  SelectedFile,
  SelectFilesOptions,
  SelectFilesResult,
} from '@vultisig/examples-shared'

/**
 * Electron File Adapter - uses native dialogs via IPC
 */
export class ElectronFileAdapter implements IFileAdapter {
  /**
   * Open a file picker dialog using native dialog
   */
  async selectFiles(options?: SelectFilesOptions): Promise<SelectFilesResult> {
    const result = await window.electronAPI.openFileDialog({
      title: options?.title,
      filters: options?.filters,
      multiSelections: options?.multiple,
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, files: [] }
    }

    const files: SelectedFile[] = result.filePaths.map(filePath => ({
      name: filePath.split('/').pop() || filePath.split('\\').pop() || filePath,
      path: filePath,
    }))

    return { canceled: false, files }
  }

  /**
   * Read content from a selected file via IPC
   */
  async readFile(file: SelectedFile): Promise<string> {
    if (!file.path) {
      throw new Error('No file path available')
    }

    return window.electronAPI.readFile(file.path)
  }

  /**
   * Save content to a file using native save dialog
   */
  async saveFile(content: string, options?: SaveFileOptions): Promise<boolean> {
    const result = await window.electronAPI.saveFileDialog({
      title: options?.title,
      defaultPath: options?.defaultName,
      filters: options?.filters,
    })

    if (result.canceled || !result.filePath) {
      return false
    }

    await window.electronAPI.writeFile(result.filePath, content)
    return true
  }
}
