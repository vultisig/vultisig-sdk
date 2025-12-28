import type { EventLogEntry } from '@/types'

let eventIdCounter = 0

/**
 * Create a new event log entry
 */
export function createEvent(
  type: EventLogEntry['type'],
  source: EventLogEntry['source'],
  message: string,
  data?: any
): EventLogEntry {
  return {
    id: `event-${++eventIdCounter}-${Date.now()}`,
    timestamp: new Date(),
    type,
    source,
    message,
    data,
  }
}

/**
 * Format event timestamp for display
 */
export function formatEventTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
