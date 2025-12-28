import { useEffect, useRef, useState } from 'react'

import Button from '@/components/common/Button'
import type { EventLogEntry } from '@/types'
import { formatEventTime } from '@/utils/events'

type EventLogProps = {
  events: EventLogEntry[]
  onClear: () => void
}

export default function EventLog({ events, onClear }: EventLogProps) {
  const logRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [events, autoScroll])

  const eventColors = {
    info: 'border-blue-500',
    success: 'border-green-500',
    warning: 'border-yellow-500',
    error: 'border-red-500',
    balance: 'border-purple-500',
    transaction: 'border-cyan-500',
    signing: 'border-pink-500',
    vault: 'border-indigo-500',
    chain: 'border-teal-500',
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white">
        <h3 className="text-lg font-semibold">Event Log</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto-scroll
          </label>
          <Button variant="secondary" size="small" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>

      {/* Log Content */}
      <div ref={logRef} className="flex-1 overflow-y-auto p-2 space-y-1">
        {events.length === 0 ? (
          <div className="text-center text-gray-400 py-8">No events yet</div>
        ) : (
          events.map(event => (
            <div key={event.id} className={`border-l-4 ${eventColors[event.type]} bg-white p-2 text-sm rounded`}>
              <div className="flex items-start gap-2">
                <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
                  {formatEventTime(event.timestamp)}
                </span>
                <span className="text-xs font-medium text-gray-600 uppercase">{event.source}</span>
                <span className="flex-1 text-gray-800">{event.message}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
