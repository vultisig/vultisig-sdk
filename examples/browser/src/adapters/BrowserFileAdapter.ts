import type {
  IFileAdapter,
  SaveFileOptions,
  SelectedFile,
  SelectFilesOptions,
  SelectFilesResult,
} from '@vultisig/examples-shared'

/**
 * Browser File Adapter - uses File API and Blob for file operations
 */
export class BrowserFileAdapter implements IFileAdapter {
  /**
   * Open a file picker dialog using a hidden input element
   */
  async selectFiles(options?: SelectFilesOptions): Promise<SelectFilesResult> {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = options?.multiple ?? false

      // Build accept attribute from filters
      if (options?.filters && options.filters.length > 0) {
        const extensions = options.filters.flatMap(f => f.extensions.map(ext => `.${ext}`))
        input.accept = extensions.join(',')
      }

      input.onchange = () => {
        if (!input.files || input.files.length === 0) {
          resolve({ canceled: true, files: [] })
          return
        }

        const files: SelectedFile[] = Array.from(input.files).map(file => ({
          name: file.name,
          file,
        }))

        resolve({ canceled: false, files })
      }

      // Handle cancel (when user closes dialog without selecting)
      input.oncancel = () => {
        resolve({ canceled: true, files: [] })
      }

      // Click to open file dialog
      input.click()
    })
  }

  /**
   * Read content from a selected file using FileReader
   */
  async readFile(file: SelectedFile): Promise<string> {
    const fileObj = file.file
    if (!fileObj) {
      throw new Error('No file object available')
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = () => {
        const result = reader.result
        if (typeof result === 'string') {
          resolve(result)
        } else {
          reject(new Error('Failed to read file as text'))
        }
      }

      reader.onerror = () => {
        reject(new Error('Failed to read file'))
      }

      reader.readAsText(fileObj)
    })
  }

  /**
   * Save content to a file using Blob and download link
   */
  async saveFile(content: string, options?: SaveFileOptions): Promise<boolean> {
    try {
      const blob = new Blob([content], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = options?.defaultName || 'file.txt'

      // Append to body, click, and remove
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // Clean up the URL object
      URL.revokeObjectURL(url)

      return true
    } catch (error) {
      console.error('Failed to save file:', error)
      return false
    }
  }
}
