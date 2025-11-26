import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PasswordCacheService } from "../../../src/services/PasswordCacheService";

describe("PasswordCacheService", () => {
  let service: PasswordCacheService;

  beforeEach(() => {
    // Reset singleton for each test
    PasswordCacheService.resetInstance();
    service = PasswordCacheService.getInstance();
  });

  afterEach(() => {
    service.clear();
  });

  describe("Basic Operations", () => {
    it("should cache and retrieve password", () => {
      service.set("vault1", "password123");
      expect(service.get("vault1")).toBe("password123");
    });

    it("should return undefined for non-existent vault", () => {
      expect(service.get("nonexistent")).toBeUndefined();
    });

    it("should delete password", () => {
      service.set("vault1", "password123");
      service.delete("vault1");
      expect(service.get("vault1")).toBeUndefined();
    });

    it("should clear all passwords", () => {
      service.set("vault1", "password1");
      service.set("vault2", "password2");
      service.clear();
      expect(service.get("vault1")).toBeUndefined();
      expect(service.get("vault2")).toBeUndefined();
    });

    it("should check if password exists", () => {
      service.set("vault1", "password123");
      expect(service.has("vault1")).toBe(true);
      expect(service.has("vault2")).toBe(false);
    });

    it("should handle multiple vaults independently", () => {
      service.set("vault1", "password1");
      service.set("vault2", "password2");
      service.set("vault3", "password3");

      expect(service.get("vault1")).toBe("password1");
      expect(service.get("vault2")).toBe("password2");
      expect(service.get("vault3")).toBe("password3");

      service.delete("vault2");

      expect(service.get("vault1")).toBe("password1");
      expect(service.get("vault2")).toBeUndefined();
      expect(service.get("vault3")).toBe("password3");
    });
  });

  describe("TTL and Expiry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should expire password after TTL", () => {
      service.set("vault1", "password123", 5000); // 5 seconds

      expect(service.get("vault1")).toBe("password123");

      vi.advanceTimersByTime(5001);

      expect(service.get("vault1")).toBeUndefined();
    });

    it("should use default TTL if not specified", () => {
      PasswordCacheService.resetInstance();
      service = PasswordCacheService.getInstance({ defaultTTL: 10000 });
      service.set("vault1", "password123");

      vi.advanceTimersByTime(9999);
      expect(service.get("vault1")).toBe("password123");

      vi.advanceTimersByTime(2);
      expect(service.get("vault1")).toBeUndefined();
    });

    it("should return remaining TTL", () => {
      service.set("vault1", "password123", 10000);

      vi.advanceTimersByTime(3000);

      const remaining = service.getRemainingTTL("vault1");
      expect(remaining).toBeGreaterThan(6900);
      expect(remaining).toBeLessThan(7100);
    });

    it("should return undefined for expired TTL", () => {
      service.set("vault1", "password123", 5000);

      vi.advanceTimersByTime(6000);

      expect(service.getRemainingTTL("vault1")).toBeUndefined();
    });

    it("should update TTL when re-setting password", () => {
      service.set("vault1", "password123", 5000);

      vi.advanceTimersByTime(4000);

      service.set("vault1", "newpassword", 10000);

      vi.advanceTimersByTime(6000);

      expect(service.get("vault1")).toBe("newpassword");
    });

    it("should not expire before TTL", () => {
      service.set("vault1", "password123", 10000);

      vi.advanceTimersByTime(9999);

      expect(service.get("vault1")).toBe("password123");
      expect(service.has("vault1")).toBe(true);
    });
  });

  describe("Disabled Mode", () => {
    it("should not cache when TTL is 0", () => {
      PasswordCacheService.resetInstance();
      service = PasswordCacheService.getInstance({ defaultTTL: 0 });

      service.set("vault1", "password123");

      expect(service.get("vault1")).toBeUndefined();
      expect(service.has("vault1")).toBe(false);
    });

    it("should clear cache when TTL set to 0 at runtime", () => {
      service.set("vault1", "password123");
      expect(service.get("vault1")).toBe("password123");

      service.updateConfig({ defaultTTL: 0 });

      expect(service.get("vault1")).toBeUndefined();
    });

    it("should respect explicit TTL of 0", () => {
      PasswordCacheService.resetInstance();
      service = PasswordCacheService.getInstance({ defaultTTL: 300000 });

      service.set("vault1", "password123", 0);

      expect(service.get("vault1")).toBeUndefined();
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance", () => {
      const instance1 = PasswordCacheService.getInstance();
      const instance2 = PasswordCacheService.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should share cache across instances", () => {
      const instance1 = PasswordCacheService.getInstance();
      instance1.set("vault1", "password123");

      const instance2 = PasswordCacheService.getInstance();

      expect(instance2.get("vault1")).toBe("password123");
    });

    it("should reset instance for testing", () => {
      const instance1 = PasswordCacheService.getInstance();
      instance1.set("vault1", "password123");

      PasswordCacheService.resetInstance();

      const instance2 = PasswordCacheService.getInstance();
      expect(instance2.get("vault1")).toBeUndefined();
    });
  });

  describe("Statistics", () => {
    it("should return cache statistics", () => {
      service.set("vault1", "password1");
      service.set("vault2", "password2");

      const stats = service.getStats();

      expect(stats.total).toBe(2);
      expect(stats.expired).toBe(0);
    });

    it("should update stats after entries expire and are deleted", async () => {
      vi.useFakeTimers();

      service.set("vault1", "password1", 5000);
      service.set("vault2", "password2", 10000);

      // Initially 2 entries
      expect(service.getStats().total).toBe(2);

      // Advance past vault1 expiry - timer will delete it
      vi.advanceTimersByTime(5001);

      // Now should have 1 entry (vault2)
      const stats = service.getStats();
      expect(stats.total).toBe(1);

      vi.useRealTimers();
    });

    it("should return zero stats for empty cache", () => {
      const stats = service.getStats();

      expect(stats.total).toBe(0);
      expect(stats.expired).toBe(0);
    });
  });

  describe("Memory Cleanup", () => {
    it("should zero out password bytes on delete", () => {
      service.set("vault1", "password123");

      const getCacheEntry = () => {
        return (service as any).cache.get("vault1");
      };

      const entry = getCacheEntry();
      expect(entry.password).toBeInstanceOf(Uint8Array);

      // Store reference to byte array
      const passwordBytes = entry.password;

      service.delete("vault1");

      // Verify all bytes are zeroed
      for (let i = 0; i < passwordBytes.length; i++) {
        expect(passwordBytes[i]).toBe(0);
      }

      // Cache entry should be removed
      expect(getCacheEntry()).toBeUndefined();
    });

    it("should zero out old password when updating", () => {
      service.set("vault1", "oldpassword");

      const entry1 = (service as any).cache.get("vault1");
      const oldPasswordBytes = entry1.password;

      // Update with new password
      service.set("vault1", "newpassword");

      // Old password bytes should be zeroed
      for (let i = 0; i < oldPasswordBytes.length; i++) {
        expect(oldPasswordBytes[i]).toBe(0);
      }

      // New password should be set correctly
      expect(service.get("vault1")).toBe("newpassword");
    });

    it("should correctly convert between string and Uint8Array", () => {
      const testPasswords = [
        "simple",
        "with spaces",
        "special!@#$%",
        "unicode: émojis 🔐",
        "very long password ".repeat(10),
      ];

      testPasswords.forEach((password) => {
        service.set("vault1", password);
        expect(service.get("vault1")).toBe(password);
        service.delete("vault1");
      });
    });

    it("should handle clear() with memory zeroing", () => {
      service.set("vault1", "password1");
      service.set("vault2", "password2");

      const entry1 = (service as any).cache.get("vault1");
      const entry2 = (service as any).cache.get("vault2");
      const bytes1 = entry1.password;
      const bytes2 = entry2.password;

      service.clear();

      // All bytes should be zeroed
      for (let i = 0; i < bytes1.length; i++) {
        expect(bytes1[i]).toBe(0);
      }
      for (let i = 0; i < bytes2.length; i++) {
        expect(bytes2[i]).toBe(0);
      }

      // Cache should be empty
      expect(service.getStats().total).toBe(0);
    });
  });

  describe("Config Updates", () => {
    it("should update default TTL", () => {
      vi.useFakeTimers();

      service.updateConfig({ defaultTTL: 20000 });
      service.set("vault1", "password123");

      vi.advanceTimersByTime(15000);
      expect(service.get("vault1")).toBe("password123");

      vi.advanceTimersByTime(6000);
      expect(service.get("vault1")).toBeUndefined();

      vi.useRealTimers();
    });

    it("should clear passwords when disabling cache", () => {
      service.set("vault1", "password123");
      service.set("vault2", "password456");

      service.updateConfig({ defaultTTL: 0 });

      expect(service.get("vault1")).toBeUndefined();
      expect(service.get("vault2")).toBeUndefined();
      expect(service.getStats().total).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle deleting non-existent vault", () => {
      expect(() => service.delete("nonexistent")).not.toThrow();
    });

    it("should handle empty password", () => {
      service.set("vault1", "");
      expect(service.get("vault1")).toBe("");
    });

    it("should handle very long passwords", () => {
      const longPassword = "a".repeat(10000);
      service.set("vault1", longPassword);
      expect(service.get("vault1")).toBe(longPassword);
    });

    it("should return undefined for getRemainingTTL on non-existent vault", () => {
      expect(service.getRemainingTTL("nonexistent")).toBeUndefined();
    });

    it("should handle rapid set/delete cycles", () => {
      for (let i = 0; i < 100; i++) {
        service.set("vault1", `password${i}`);
        if (i % 2 === 0) {
          service.delete("vault1");
        }
      }

      expect(service.get("vault1")).toBe("password99");
    });
  });
});
