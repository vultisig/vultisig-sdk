# Vultisig Electron Example

Desktop application example demonstrating the Vultisig SDK with Electron.

## Features

- Fast vault creation with email verification
- Secure vault creation with multi-device MPC (QR pairing)
- Import/export vault files
- Check balances across multiple chains
- Send transactions (fast vault: instant, secure vault: device coordination)
- Cross-chain swaps with discount tier display
- Real-time event logging

## Getting Started

### Prerequisites

- Node.js 20+
- Yarn

### Development

```bash
cd examples/electron
yarn install
yarn dev
```

### Build Desktop App

```bash
# Build for current platform
yarn dist

# Platform-specific
yarn dist:mac
yarn dist:win
yarn dist:linux
```

Build output is in the `dist/` directory. Packaged app is in `dist-electron/`.

## Architecture

- **Electron Main Process**: IPC handlers for SDK vault operations (`electron/main.ts`)
- **React Renderer**: UI built with React 18, Vite, and Tailwind CSS
- **Shared Adapters**: Reuses `@vultisig/examples-shared` for SDK/vault adapter patterns
- **Electron-specific Adapter**: `src/adapters/ElectronSDKAdapter.ts` bridges renderer to main process via IPC
- **Storage**: File-based storage via SDK's Electron Main platform bundle

## Project Structure

```
examples/electron/
├── electron/              # Electron main process
│   └── main.ts            # IPC handlers, window management
├── src/
│   ├── App.tsx            # Main React component
│   ├── adapters/          # Electron-specific SDK adapters
│   │   ├── ElectronSDKAdapter.ts
│   │   └── ElectronFileAdapter.ts
│   └── main.tsx           # React entry point
├── electron-builder.json5 # Packaging config
├── vite.config.ts         # Vite + Electron plugin config
└── index.html
```

## Troubleshooting

### WASM Loading Fails

Ensure WASM files are accessible in the Electron main process. Check `electron-builder.json5` for file inclusion rules.

### IPC Errors

Verify that the main process IPC handlers match the renderer's expected channels. Check `electron/main.ts`.

## License

MIT
