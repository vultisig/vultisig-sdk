/**
 * Unit Tests for UniversalEventEmitter
 *
 * Tests the type-safe event emitter that works in all JavaScript environments.
 * Features tested:
 * - Type-safe event names and payloads
 * - Memory leak detection
 * - Error isolation (handler errors don't break emission)
 * - Support for once() listeners
 * - Cleanup and unsubscribe functionality
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { UniversalEventEmitter } from "../../../src/events/EventEmitter";

// Define test event types
type TestEvents = {
  message: string;
  count: number;
  data: { id: string; value: number };
  error: Error;
  empty: void;
} & Record<string, unknown>;

// Create a testable class that exposes emit()
class TestEventEmitter extends UniversalEventEmitter<TestEvents> {
  public emitEvent<K extends keyof TestEvents>(
    event: K,
    data: TestEvents[K],
  ): void {
    this.emit(event, data);
  }
}

describe("UniversalEventEmitter", () => {
  let emitter: TestEventEmitter;

  beforeEach(() => {
    emitter = new TestEventEmitter();
    // Suppress console warnings during tests
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("on() - Register event listeners", () => {
    it("should register a listener and call it when event is emitted", () => {
      const handler = vi.fn();
      emitter.on("message", handler);

      emitter.emitEvent("message", "test message");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("test message");
    });

    it("should support multiple listeners for the same event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      emitter.on("message", handler1);
      emitter.on("message", handler2);
      emitter.on("message", handler3);

      emitter.emitEvent("message", "test");

      expect(handler1).toHaveBeenCalledWith("test");
      expect(handler2).toHaveBeenCalledWith("test");
      expect(handler3).toHaveBeenCalledWith("test");
    });

    it("should support different event types with typed payloads", () => {
      const messageHandler = vi.fn();
      const countHandler = vi.fn();
      const dataHandler = vi.fn();

      emitter.on("message", messageHandler);
      emitter.on("count", countHandler);
      emitter.on("data", dataHandler);

      emitter.emitEvent("message", "hello");
      emitter.emitEvent("count", 42);
      emitter.emitEvent("data", { id: "test", value: 100 });

      expect(messageHandler).toHaveBeenCalledWith("hello");
      expect(countHandler).toHaveBeenCalledWith(42);
      expect(dataHandler).toHaveBeenCalledWith({ id: "test", value: 100 });
    });

    it("should return an unsubscribe function", () => {
      const handler = vi.fn();
      const unsubscribe = emitter.on("message", handler);

      emitter.emitEvent("message", "first");
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      emitter.emitEvent("message", "second");
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it("should deduplicate the same handler (Set behavior)", () => {
      const handler = vi.fn();

      emitter.on("message", handler);
      emitter.on("message", handler); // Adding same handler again

      emitter.emitEvent("message", "test");

      // Handler is called once (Set deduplicates)
      expect(handler).toHaveBeenCalledTimes(1);
      expect(emitter.listenerCount("message")).toBe(1);
    });

    it("should warn when too many listeners are registered (memory leak detection)", () => {
      const warnSpy = vi.spyOn(console, "warn");

      // Register 11 listeners (default max is 10)
      for (let i = 0; i < 11; i++) {
        emitter.on("message", () => {});
      }

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Possible memory leak"),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("11 listeners"),
      );
    });

    it("should warn even when max listeners is 0 (check is size > max)", () => {
      const warnSpy = vi.spyOn(console, "warn");
      emitter.setMaxListeners(0);

      // Register a listener - will warn since 1 > 0
      emitter.on("message", () => {});

      expect(warnSpy).toHaveBeenCalled();
    });

    it("should handle void event types", () => {
      const handler = vi.fn();
      emitter.on("empty", handler);

      emitter.emitEvent("empty", undefined);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(undefined);
    });
  });

  describe("once() - One-time event listeners", () => {
    it("should call listener only once then auto-remove", () => {
      const handler = vi.fn();
      emitter.once("message", handler);

      emitter.emitEvent("message", "first");
      emitter.emitEvent("message", "second");
      emitter.emitEvent("message", "third");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("first");
    });

    it("should return an unsubscribe function", () => {
      const handler = vi.fn();
      const unsubscribe = emitter.once("message", handler);

      unsubscribe();

      emitter.emitEvent("message", "test");

      expect(handler).not.toHaveBeenCalled();
    });

    it("should work with multiple once listeners", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.once("message", handler1);
      emitter.once("message", handler2);

      emitter.emitEvent("message", "test");

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);

      emitter.emitEvent("message", "test2");

      expect(handler1).toHaveBeenCalledTimes(1); // Still 1
      expect(handler2).toHaveBeenCalledTimes(1); // Still 1
    });

    it("should allow mixing on() and once() listeners", () => {
      const onHandler = vi.fn();
      const onceHandler = vi.fn();

      emitter.on("message", onHandler);
      emitter.once("message", onceHandler);

      emitter.emitEvent("message", "first");
      emitter.emitEvent("message", "second");

      expect(onHandler).toHaveBeenCalledTimes(2);
      expect(onceHandler).toHaveBeenCalledTimes(1);
    });

    it("should properly track once wrapper in WeakMap", () => {
      const handler = vi.fn();
      emitter.once("message", handler);

      // Verify listener is registered
      expect(emitter.listenerCount("message")).toBe(1);

      // off() should remove the wrapper
      emitter.off("message", handler);

      expect(emitter.listenerCount("message")).toBe(0);

      // Emit should not call handler
      emitter.emitEvent("message", "test");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("off() - Unregister event listeners", () => {
    it("should remove a registered listener", () => {
      const handler = vi.fn();
      emitter.on("message", handler);

      emitter.emitEvent("message", "first");
      expect(handler).toHaveBeenCalledTimes(1);

      emitter.off("message", handler);

      emitter.emitEvent("message", "second");
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it("should remove specific listener without affecting others", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on("message", handler1);
      emitter.on("message", handler2);

      emitter.off("message", handler1);

      emitter.emitEvent("message", "test");

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should handle removing non-existent listener gracefully", () => {
      const handler = vi.fn();

      // Should not throw
      expect(() => {
        emitter.off("message", handler);
      }).not.toThrow();
    });

    it("should handle removing listener from non-existent event", () => {
      const handler = vi.fn();

      // Should not throw
      expect(() => {
        emitter.off("message", handler);
      }).not.toThrow();
    });

    it("should clean up empty listener sets after removal", () => {
      const handler = vi.fn();
      emitter.on("message", handler);

      expect(emitter.hasListeners("message")).toBe(true);

      emitter.off("message", handler);

      expect(emitter.hasListeners("message")).toBe(false);
      expect(emitter.eventNames()).not.toContain("message");
    });

    it("should remove once() listener wrapper correctly", () => {
      const handler = vi.fn();
      emitter.once("message", handler);

      emitter.off("message", handler);

      emitter.emitEvent("message", "test");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("emit() - Emit events to listeners", () => {
    it("should call all registered listeners with correct data", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on("count", handler1);
      emitter.on("count", handler2);

      emitter.emitEvent("count", 42);

      expect(handler1).toHaveBeenCalledWith(42);
      expect(handler2).toHaveBeenCalledWith(42);
    });

    it("should handle emitting to event with no listeners", () => {
      // Should not throw
      expect(() => {
        emitter.emitEvent("message", "test");
      }).not.toThrow();
    });

    it("should isolate handler errors - one error does not stop others", () => {
      const errorSpy = vi.spyOn(console, "error");
      const handler1 = vi.fn();
      const handler2 = vi.fn(() => {
        throw new Error("Handler 2 error");
      });
      const handler3 = vi.fn();

      emitter.on("message", handler1);
      emitter.on("message", handler2);
      emitter.on("message", handler3);

      emitter.emitEvent("message", "test");

      // All handlers should be called
      expect(handler1).toHaveBeenCalledWith("test");
      expect(handler2).toHaveBeenCalledWith("test");
      expect(handler3).toHaveBeenCalledWith("test");

      // Error should be logged
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error in handler"),
        expect.any(Error),
      );
    });

    it("should emit error events to error handlers when handler throws", () => {
      const errorHandler = vi.fn();
      emitter.on("error", errorHandler);

      const throwingHandler = vi.fn(() => {
        throw new Error("Test error");
      });

      emitter.on("message", throwingHandler);

      emitter.emitEvent("message", "test");

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(errorHandler.mock.calls[0][0].message).toBe("Test error");
    });

    it("should prevent infinite loop if error handler throws", () => {
      const errorHandler = vi.fn(() => {
        throw new Error("Error in error handler");
      });

      emitter.on("error", errorHandler);

      // Should not cause infinite loop
      expect(() => {
        emitter.emitEvent("error", new Error("Original error"));
      }).not.toThrow();

      // Error handler should be called
      expect(errorHandler).toHaveBeenCalled();
    });

    it("should not emit error events when emitting error event itself", () => {
      const errorHandler = vi.fn();
      emitter.on("error", errorHandler);

      const testError = new Error("Test error");
      emitter.emitEvent("error", testError);

      // Should be called once for the direct emit
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(testError);
    });

    it("should handle modifications during emission safely", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn(() => {
        // Remove handler3 during emission
        emitter.off("message", handler3);
      });
      const handler3 = vi.fn();

      emitter.on("message", handler1);
      emitter.on("message", handler2);
      emitter.on("message", handler3);

      // Should not throw even though handler set is modified during emission
      expect(() => {
        emitter.emitEvent("message", "test");
      }).not.toThrow();

      // All handlers should still be called (uses array copy)
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });

    it("should pass complex object payloads correctly", () => {
      const handler = vi.fn();
      emitter.on("data", handler);

      const complexData = { id: "abc123", value: 999 };
      emitter.emitEvent("data", complexData);

      expect(handler).toHaveBeenCalledWith(complexData);
      expect(handler.mock.calls[0][0]).toBe(complexData); // Same reference
    });
  });

  describe("removeAllListeners() - Bulk listener removal", () => {
    it("should remove all listeners for specific event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on("message", handler1);
      emitter.on("message", handler2);

      expect(emitter.listenerCount("message")).toBe(2);

      emitter.removeAllListeners("message");

      expect(emitter.listenerCount("message")).toBe(0);

      emitter.emitEvent("message", "test");
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it("should remove all listeners for all events when no event specified", () => {
      emitter.on("message", vi.fn());
      emitter.on("count", vi.fn());
      emitter.on("data", vi.fn());

      expect(emitter.eventNames().length).toBeGreaterThan(0);

      emitter.removeAllListeners();

      expect(emitter.eventNames().length).toBe(0);
      expect(emitter.listenerCount("message")).toBe(0);
      expect(emitter.listenerCount("count")).toBe(0);
      expect(emitter.listenerCount("data")).toBe(0);
    });

    it("should not affect other events when removing specific event", () => {
      const messageHandler = vi.fn();
      const countHandler = vi.fn();

      emitter.on("message", messageHandler);
      emitter.on("count", countHandler);

      emitter.removeAllListeners("message");

      expect(emitter.listenerCount("message")).toBe(0);
      expect(emitter.listenerCount("count")).toBe(1);

      emitter.emitEvent("count", 42);
      expect(countHandler).toHaveBeenCalledWith(42);
    });

    it("should handle removing listeners from non-existent event", () => {
      // Should not throw
      expect(() => {
        emitter.removeAllListeners("message");
      }).not.toThrow();
    });
  });

  describe("listenerCount() - Get listener count", () => {
    it("should return correct count for event with listeners", () => {
      emitter.on("message", vi.fn());
      emitter.on("message", vi.fn());
      emitter.on("message", vi.fn());

      expect(emitter.listenerCount("message")).toBe(3);
    });

    it("should return 0 for event with no listeners", () => {
      expect(emitter.listenerCount("message")).toBe(0);
    });

    it("should update count after adding/removing listeners", () => {
      const handler = vi.fn();

      expect(emitter.listenerCount("message")).toBe(0);

      emitter.on("message", handler);
      expect(emitter.listenerCount("message")).toBe(1);

      emitter.off("message", handler);
      expect(emitter.listenerCount("message")).toBe(0);
    });

    it("should count once() listeners", () => {
      emitter.once("message", vi.fn());
      emitter.once("message", vi.fn());

      expect(emitter.listenerCount("message")).toBe(2);
    });
  });

  describe("eventNames() - Get registered event names", () => {
    it("should return empty array when no listeners registered", () => {
      expect(emitter.eventNames()).toEqual([]);
    });

    it("should return array of event names with listeners", () => {
      emitter.on("message", vi.fn());
      emitter.on("count", vi.fn());
      emitter.on("data", vi.fn());

      const names = emitter.eventNames();

      expect(names).toContain("message");
      expect(names).toContain("count");
      expect(names).toContain("data");
      expect(names.length).toBe(3);
    });

    it("should not include event after all listeners removed", () => {
      const handler = vi.fn();
      emitter.on("message", handler);

      expect(emitter.eventNames()).toContain("message");

      emitter.off("message", handler);

      expect(emitter.eventNames()).not.toContain("message");
    });

    it("should update after removeAllListeners()", () => {
      emitter.on("message", vi.fn());
      emitter.on("count", vi.fn());

      expect(emitter.eventNames().length).toBe(2);

      emitter.removeAllListeners();

      expect(emitter.eventNames().length).toBe(0);
    });
  });

  describe("setMaxListeners() / getMaxListeners() - Memory leak configuration", () => {
    it("should allow setting max listeners", () => {
      expect(emitter.getMaxListeners()).toBe(10); // Default

      emitter.setMaxListeners(20);

      expect(emitter.getMaxListeners()).toBe(20);
    });

    it("should allow disabling warning by setting to 0", () => {
      emitter.setMaxListeners(0);
      expect(emitter.getMaxListeners()).toBe(0);
    });

    it("should respect new max listener limit", () => {
      const warnSpy = vi.spyOn(console, "warn");
      emitter.setMaxListeners(5);

      // Register 6 listeners (exceeds new limit)
      for (let i = 0; i < 6; i++) {
        emitter.on("message", () => {});
      }

      expect(warnSpy).toHaveBeenCalled();
    });

    it("should not warn when under new max limit", () => {
      const warnSpy = vi.spyOn(console, "warn");
      emitter.setMaxListeners(20);

      // Register 15 listeners (under new limit)
      for (let i = 0; i < 15; i++) {
        emitter.on("message", () => {});
      }

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("hasListeners() - Check for listeners", () => {
    it("should return false for event with no listeners", () => {
      expect(emitter.hasListeners("message")).toBe(false);
    });

    it("should return true for event with listeners", () => {
      emitter.on("message", vi.fn());

      expect(emitter.hasListeners("message")).toBe(true);
    });

    it("should return false after removing all listeners", () => {
      const handler = vi.fn();
      emitter.on("message", handler);

      expect(emitter.hasListeners("message")).toBe(true);

      emitter.off("message", handler);

      expect(emitter.hasListeners("message")).toBe(false);
    });

    it("should work with once() listeners", () => {
      emitter.once("message", vi.fn());

      expect(emitter.hasListeners("message")).toBe(true);

      emitter.emitEvent("message", "test");

      expect(emitter.hasListeners("message")).toBe(false);
    });
  });

  describe("Integration Tests - Complex Scenarios", () => {
    it("should handle complex workflow with multiple operations", () => {
      const messageHandler = vi.fn();
      const countHandler = vi.fn();
      const onceHandler = vi.fn();

      // Register various listeners
      const unsub1 = emitter.on("message", messageHandler);
      emitter.on("count", countHandler);
      emitter.once("count", onceHandler);

      // Emit events
      emitter.emitEvent("message", "hello");
      emitter.emitEvent("count", 1);

      expect(messageHandler).toHaveBeenCalledTimes(1);
      expect(countHandler).toHaveBeenCalledTimes(1);
      expect(onceHandler).toHaveBeenCalledTimes(1);

      // Unsubscribe and emit again
      unsub1();
      emitter.emitEvent("message", "world");
      emitter.emitEvent("count", 2);

      expect(messageHandler).toHaveBeenCalledTimes(1); // Not called again
      expect(countHandler).toHaveBeenCalledTimes(2);
      expect(onceHandler).toHaveBeenCalledTimes(1); // Once only

      // Clean up
      emitter.removeAllListeners();

      expect(emitter.eventNames().length).toBe(0);
    });

    it("should handle rapid subscribe/unsubscribe cycles", () => {
      const handler = vi.fn();

      for (let i = 0; i < 100; i++) {
        const unsub = emitter.on("message", handler);
        unsub();
      }

      expect(emitter.listenerCount("message")).toBe(0);

      emitter.emitEvent("message", "test");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should handle multiple event types simultaneously", () => {
      const handlers = {
        message: vi.fn(),
        count: vi.fn(),
        data: vi.fn(),
        error: vi.fn(),
      };

      Object.entries(handlers).forEach(([event, handler]) => {
        emitter.on(event as keyof TestEvents, handler as never);
      });

      emitter.emitEvent("message", "test");
      emitter.emitEvent("count", 42);
      emitter.emitEvent("data", { id: "test", value: 100 });
      emitter.emitEvent("error", new Error("test"));

      expect(handlers.message).toHaveBeenCalledWith("test");
      expect(handlers.count).toHaveBeenCalledWith(42);
      expect(handlers.data).toHaveBeenCalledWith({ id: "test", value: 100 });
      expect(handlers.error).toHaveBeenCalledWith(expect.any(Error));
    });

    it("should maintain type safety with complex event data", () => {
      const handler = vi.fn((data: { id: string; value: number }) => {
        expect(typeof data.id).toBe("string");
        expect(typeof data.value).toBe("number");
      });

      emitter.on("data", handler);

      emitter.emitEvent("data", { id: "test-123", value: 999 });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("Edge Cases and Error Conditions", () => {
    it("should handle emitting same event recursively from handler", () => {
      let count = 0;
      const handler = vi.fn(() => {
        count++;
        // Prevent infinite recursion
        if (count < 3) {
          emitter.emitEvent("message", `recursive ${count}`);
        }
      });

      emitter.on("message", handler);

      emitter.emitEvent("message", "start");

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("should handle adding listeners during emission", () => {
      const handler1 = vi.fn(() => {
        // Add new listener during emission
        emitter.on("message", handler3);
      });
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      emitter.on("message", handler1);
      emitter.on("message", handler2);

      emitter.emitEvent("message", "test1");

      // handler3 added during emission should not be called for current emit
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(0);

      // But should be called for next emit
      emitter.emitEvent("message", "test2");
      expect(handler3).toHaveBeenCalledTimes(1);
    });

    it("should handle undefined and null values", () => {
      const handler = vi.fn();
      emitter.on("empty", handler);

      emitter.emitEvent("empty", undefined);

      expect(handler).toHaveBeenCalledWith(undefined);
    });

    it("should handle very large number of listeners without crashing", () => {
      const warnSpy = vi.spyOn(console, "warn");

      // Add 1000 listeners
      for (let i = 0; i < 1000; i++) {
        emitter.on("message", () => {});
      }

      expect(emitter.listenerCount("message")).toBe(1000);
      expect(warnSpy).toHaveBeenCalled(); // Should warn about memory leak

      // Should still work
      emitter.emitEvent("message", "test");
    });

    it("should handle async handlers (fire and forget)", () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      emitter.on("message", handler);

      // Emit should not wait for async handler
      expect(() => {
        emitter.emitEvent("message", "test");
      }).not.toThrow();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("Type Safety Tests", () => {
    it("should enforce type safety at compile time", () => {
      // These would cause TypeScript errors if types are wrong:
      // emitter.on('message', (data: number) => {}) // Error: string expected
      // emitter.on('invalid_event', () => {}) // Error: not in TestEvents
      // emitter.emitEvent('count', 'string') // Error: number expected

      // Valid usage
      const handler = vi.fn((data: string) => {
        expect(typeof data).toBe("string");
      });

      emitter.on("message", handler);
      emitter.emitEvent("message", "test");

      expect(handler).toHaveBeenCalled();
    });
  });
});
