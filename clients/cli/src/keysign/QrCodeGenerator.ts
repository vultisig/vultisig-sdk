import * as QRCode from 'qrcode'
import { promises as fs } from 'fs'
import * as path from 'path'

export interface QrCodeOptions {
  uri: string
  width?: number
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  margin?: number
  color?: {
    dark?: string
    light?: string
  }
}

export class QrCodeGenerator {
  private static readonly DEFAULT_OPTIONS: Partial<QrCodeOptions> = {
    width: 400,
    errorCorrectionLevel: 'H', // High error correction for better scanning
    margin: 4,
    color: {
      dark: '#000000',  // Black foreground
      light: '#FFFFFF'  // White background
    }
  }
  
  /**
   * Generate QR code as SVG string
   */
  async generateSvg(options: QrCodeOptions): Promise<string> {
    const opts = { ...QrCodeGenerator.DEFAULT_OPTIONS, ...options }
    
    return QRCode.toString(options.uri, {
      type: 'svg',
      width: opts.width,
      errorCorrectionLevel: opts.errorCorrectionLevel,
      margin: opts.margin,
      color: opts.color
    })
  }
  
  /**
   * Generate QR code as PNG buffer
   */
  async generatePng(options: QrCodeOptions): Promise<Buffer> {
    const opts = { ...QrCodeGenerator.DEFAULT_OPTIONS, ...options }
    
    return QRCode.toBuffer(options.uri, {
      type: 'png',
      width: opts.width,
      errorCorrectionLevel: opts.errorCorrectionLevel,
      margin: opts.margin,
      color: opts.color
    })
  }
  
  /**
   * Generate QR code as data URL (for embedding in HTML)
   */
  async generateDataUrl(options: QrCodeOptions): Promise<string> {
    const opts = { ...QrCodeGenerator.DEFAULT_OPTIONS, ...options }
    
    return QRCode.toDataURL(options.uri, {
      width: opts.width,
      errorCorrectionLevel: opts.errorCorrectionLevel,
      margin: opts.margin,
      color: opts.color
    })
  }
  
  /**
   * Generate QR code and save to file
   */
  async saveToFile(options: QrCodeOptions, filePath: string): Promise<void> {
    const opts = { ...QrCodeGenerator.DEFAULT_OPTIONS, ...options }
    const ext = path.extname(filePath).toLowerCase()
    
    switch (ext) {
      case '.svg':
        const svg = await this.generateSvg(options)
        await fs.writeFile(filePath, svg, 'utf8')
        break
        
      case '.png':
        const png = await this.generatePng(options)
        await fs.writeFile(filePath, png)
        break
        
      default:
        throw new Error(`Unsupported file extension: ${ext}. Use .svg or .png`)
    }
  }
  
  /**
   * Print QR code to console (ASCII art)
   */
  async printToConsole(options: QrCodeOptions): Promise<void> {
    const asciiQr = await QRCode.toString(options.uri, {
      type: 'terminal',
      small: true,
      errorCorrectionLevel: options.errorCorrectionLevel || 'H'
    })
    
    console.log('\\n📱 Scan this QR code with your Vultisig mobile app:\\n')
    console.log(asciiQr)
    console.log('\\n')
  }
}