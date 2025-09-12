export type ServerStatus = 'checking' | 'online' | 'offline'

import { useEffect, useState } from 'react'
import { Vultisig } from 'vultisig-sdk'

export function useServerStatus(sdk: Vultisig) {
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking')

  useEffect(() => {
    const check = async () => {
      try {
        setServerStatus('checking')
        const status = await sdk.getServerStatus()
        setServerStatus(status.messageRelay.online ? 'online' : 'offline')
      } catch {
        setServerStatus('offline')
      }
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [sdk])

  return serverStatus
}
