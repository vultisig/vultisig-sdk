type DeviceProgressProps = {
  currentDevices: number
  requiredDevices: number
  action: 'keygen' | 'signing'
  deviceIds?: string[]
}

export default function DeviceProgress({
  currentDevices,
  requiredDevices,
  action,
  deviceIds = [],
}: DeviceProgressProps) {
  const isComplete = currentDevices >= requiredDevices
  const progress = Math.min((currentDevices / requiredDevices) * 100, 100)

  const actionText = action === 'keygen' ? 'vault creation' : 'signing'

  return (
    <div className="w-full space-y-3">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Devices Joined</span>
        <span className="text-sm text-gray-600">
          {currentDevices} / {requiredDevices}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full transition-all duration-300 ${isComplete ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Status message */}
      <div className="flex items-center gap-2">
        {isComplete ? (
          <>
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-green-600">All devices ready! Starting {actionText}...</span>
          </>
        ) : (
          <>
            <div className="animate-pulse w-2 h-2 bg-blue-500 rounded-full" />
            <span className="text-sm text-gray-600">
              Waiting for {requiredDevices - currentDevices} more device
              {requiredDevices - currentDevices !== 1 ? 's' : ''}...
            </span>
          </>
        )}
      </div>

      {/* Device list */}
      {deviceIds.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-xs font-medium text-gray-500 uppercase">Connected Devices</p>
          {deviceIds.map((deviceId, index) => (
            <div key={deviceId} className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-mono text-gray-600">
                Device {index + 1}:{' '}
                {deviceId.length > 16 ? `${deviceId.slice(0, 8)}...${deviceId.slice(-8)}` : deviceId}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
