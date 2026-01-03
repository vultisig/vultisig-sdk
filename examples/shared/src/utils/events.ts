import type { EventLogEntry, EventType } from '../types'

let eventIdCounter = 0

/**
 * Create a new event log entry
 */
export function createEvent(
  type: EventType,
  source: EventLogEntry['source'],
  message: string,
  data?: unknown
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

/**
 * Get color for event type
 */
export function getEventColor(type: EventType): string {
  const colors: Record<EventType, string> = {
    info: '#3b82f6', // blue
    success: '#10b981', // green
    warning: '#f59e0b', // amber
    error: '#ef4444', // red
    balance: '#8b5cf6', // violet
    transaction: '#06b6d4', // cyan
    signing: '#ec4899', // pink
    vault: '#6366f1', // indigo
    chain: '#14b8a6', // teal
  }
  return colors[type]
}
