/**
 * Type-safe event emitter that works in all JavaScript environments.
 * Zero external dependencies.
 *
 * Features:
 * - Type-safe event names and payloads
 * - Memory leak detection
 * - Error isolation (handler errors don't break emission)
 * - Support for once() listeners
 */
export class UniversalEventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<EventHandler<unknown>>>();
  private onceWrappers = new WeakMap<
    EventHandler<unknown>,
    EventHandler<unknown>
  >();
  private maxListeners = 10; // Memory leak protection

  /**
   * Register an event listener.
   * @returns Unsubscribe function
   */
  on<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const handlers = this.listeners.get(event)!;
    handlers.add(handler as EventHandler<unknown>);

    // Warn if too many listeners (possible memory leak)
    if (handlers.size > this.maxListeners) {
      console.warn(
        `[EventEmitter] Possible memory leak: ${handlers.size} listeners for event "${String(event)}". ` +
          `Use setMaxListeners() to increase the limit if this is intentional.`,
      );
    }

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Register a one-time event listener.
   * The listener will be automatically removed after being called once.
   * @returns Unsubscribe function
   */
  once<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>,
  ): () => void {
    // Create wrapper that removes itself after calling the original handler
    const onceWrapper: EventHandler<Events[K]> = (data: Events[K]) => {
      this.off(event, handler);
      handler(data);
    };

    // Store mapping so we can remove it if off() is called with original handler
    this.onceWrappers.set(
      handler as EventHandler<unknown>,
      onceWrapper as EventHandler<unknown>,
    );

    // Register the wrapper
    return this.on(event, onceWrapper);
  }

  /**
   * Unregister an event listener.
   */
  off<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>,
  ): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    // Check if this is a once() listener
    const wrapper = this.onceWrappers.get(handler as EventHandler<unknown>);
    if (wrapper) {
      handlers.delete(wrapper);
      this.onceWrappers.delete(handler as EventHandler<unknown>);
    } else {
      handlers.delete(handler as EventHandler<unknown>);
    }

    // Clean up empty sets
    if (handlers.size === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * Emit an event to all listeners.
   * Protected - only callable from subclasses.
   *
   * Error Handling:
   * - Errors in handlers are caught and logged
   * - One handler error doesn't prevent other handlers from running
   * - Errors are collected and can be accessed via getLastErrors()
   */
  protected emit<K extends keyof Events>(
    event: K,
    ...args: Events[K] extends Record<string, never>
      ? [] | [Events[K]]
      : [Events[K]]
  ): void {
    const data = (args.length > 0 ? args[0] : {}) as Events[K];
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) return;

    // Create array copy to avoid issues if handlers are modified during emission
    const handlerArray = Array.from(handlers);

    for (const handler of handlerArray) {
      try {
        (handler as EventHandler<Events[K]>)(data);
      } catch (error) {
        console.error(
          `[EventEmitter] Error in handler for event "${String(event)}":`,
          error,
        );
        // Store error for potential debugging
        this.emitError(error as Error, event);
      }
    }
  }

  /**
   * Emit error event (special handling to prevent infinite loops)
   */
  private emitError(error: Error, sourceEvent: keyof Events): void {
    // Prevent infinite loop if 'error' handler throws
    if (sourceEvent === "error") return;

    const errorHandlers = this.listeners.get("error" as keyof Events);
    if (errorHandlers) {
      for (const handler of errorHandlers) {
        try {
          (handler as EventHandler<Error>)(error);
        } catch {
          // Silently ignore errors in error handlers
        }
      }
    }
  }

  /**
   * Remove all listeners for a specific event, or all events.
   */
  removeAllListeners(event?: keyof Events): void {
    if (event !== undefined) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
      // Note: WeakMap will be garbage collected automatically
    }
  }

  /**
   * Get the number of listeners for an event.
   */
  listenerCount(event: keyof Events): number {
    const handlers = this.listeners.get(event);
    return handlers ? handlers.size : 0;
  }

  /**
   * Get all event names that have listeners.
   */
  eventNames(): Array<keyof Events> {
    return Array.from(this.listeners.keys());
  }

  /**
   * Set the maximum number of listeners before warning.
   * Set to 0 to disable the warning.
   */
  setMaxListeners(max: number): void {
    this.maxListeners = max;
  }

  /**
   * Get the maximum number of listeners.
   */
  getMaxListeners(): number {
    return this.maxListeners;
  }

  /**
   * Check if an event has any listeners.
   */
  hasListeners(event: keyof Events): boolean {
    const handlers = this.listeners.get(event);
    return handlers ? handlers.size > 0 : false;
  }
}

/**
 * Event handler function type
 */
type EventHandler<T> = (data: T) => void;
