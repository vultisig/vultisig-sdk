const APP_NAME = 'Vultisig SDK Example'
const APP_VERSION = '0.1.0'

export default function Header() {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{APP_NAME}</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">v{APP_VERSION}</span>
        </div>
      </div>
    </header>
  )
}
