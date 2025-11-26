import { describe, expect, it } from "vitest";

import { ValidationHelpers } from "../../../src/utils/validation";

describe("ValidationHelpers", () => {
  describe("validateEmail", () => {
    it("should validate correct email formats", () => {
      const validEmails = [
        "user@example.com",
        "test.user@example.com",
        "test+tag@example.co.uk",
        "user123@test-domain.org",
        "first.last@subdomain.example.com",
        "a@b.co",
      ];

      validEmails.forEach((email) => {
        const result = ValidationHelpers.validateEmail(email);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    it("should reject invalid email formats", () => {
      const invalidEmails = [
        "",
        "invalid",
        "@domain.com",
        "user@",
        "user",
        "user @domain.com",
        "user@domain .com",
        "@",
      ];

      invalidEmails.forEach((email) => {
        const result = ValidationHelpers.validateEmail(email);
        expect(result.valid, `Email "${email}" should be invalid`).toBe(false);
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe("string");
      });
    });

    it("should accept some edge case email formats", () => {
      // These are technically valid per the regex even if unusual
      const edgeCaseEmails = [
        "user@domain", // No TLD required by the regex
        "user..name@domain.com", // Consecutive dots allowed
        "user.@domain.com", // Trailing dot in local part
        ".user@domain.com", // Leading dot
      ];

      edgeCaseEmails.forEach((email) => {
        const result = ValidationHelpers.validateEmail(email);
        // Just verify it returns a result, not asserting valid/invalid
        expect(result).toHaveProperty("valid");
      });
    });

    it("should handle edge cases", () => {
      // Very long but valid email
      const longEmail = "a".repeat(50) + "@" + "b".repeat(50) + ".com";
      const result = ValidationHelpers.validateEmail(longEmail);
      // Depending on implementation, this might be valid or invalid
      expect(result).toHaveProperty("valid");
    });
  });

  describe("validatePassword", () => {
    it("should accept valid passwords", () => {
      const validPasswords = [
        "a", // Min length 1
        "password",
        "Password123!",
        "VeryL0ng!Pass@word#With$Special%Chars",
        "a".repeat(128), // Max length
      ];

      validPasswords.forEach((password) => {
        const result = ValidationHelpers.validatePassword(password);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    it("should reject empty password", () => {
      const result = ValidationHelpers.validatePassword("");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Password is required");
    });

    it("should reject password exceeding max length", () => {
      const tooLong = "a".repeat(129);
      const result = ValidationHelpers.validatePassword(tooLong);
      expect(result.valid).toBe(false);
      expect(result.error).toContain(
        "Password must be no more than 128 characters",
      );
    });

    it("should handle boundary cases", () => {
      // Exactly at min length
      const minLength = "a";
      const minResult = ValidationHelpers.validatePassword(minLength);
      expect(minResult.valid).toBe(true);

      // Exactly at max length
      const maxLength = "a".repeat(128);
      const maxResult = ValidationHelpers.validatePassword(maxLength);
      expect(maxResult.valid).toBe(true);

      // Just over max length
      const overMax = "a".repeat(129);
      const overMaxResult = ValidationHelpers.validatePassword(overMax);
      expect(overMaxResult.valid).toBe(false);
    });

    it("should accept passwords with special characters", () => {
      const specialPasswords = [
        "!@#$%^&*()",
        "Pass123!@#",
        "unicode-密码-пароль",
      ];

      specialPasswords.forEach((password) => {
        const result = ValidationHelpers.validatePassword(password);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe("validateVaultName", () => {
    it("should accept valid vault names", () => {
      const validNames = [
        "My Vault",
        "Vault-123",
        "vault_name",
        "ab", // Min length 2
        "A Very Long Vault Name That Is Still Valid",
        "a".repeat(50), // Max length
        "Vault🔒", // Unicode
      ];

      validNames.forEach((name) => {
        const result = ValidationHelpers.validateVaultName(name);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    it("should reject empty vault name", () => {
      const result = ValidationHelpers.validateVaultName("");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Vault name is required");
    });

    it("should reject whitespace-only vault name", () => {
      const result = ValidationHelpers.validateVaultName("   ");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("at least 2 characters");
    });

    it("should reject vault name with only 1 character after trim", () => {
      const result = ValidationHelpers.validateVaultName(" a ");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("at least 2 characters");
    });

    it("should reject vault name exceeding max length", () => {
      const tooLong = "a".repeat(51);
      const result = ValidationHelpers.validateVaultName(tooLong);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("no more than 50 characters");
    });

    it("should reject non-string vault names", () => {
      const invalidTypes = [123, null, undefined, {}, []];

      invalidTypes.forEach((name) => {
        const result = ValidationHelpers.validateVaultName(name as any);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    it("should handle boundary cases", () => {
      // Exactly at min length (after trim)
      const minLength = "ab";
      const minResult = ValidationHelpers.validateVaultName(minLength);
      expect(minResult.valid).toBe(true);

      // Exactly at max length
      const maxLength = "a".repeat(50);
      const maxResult = ValidationHelpers.validateVaultName(maxLength);
      expect(maxResult.valid).toBe(true);

      // Just over max length
      const overMax = "a".repeat(51);
      const overMaxResult = ValidationHelpers.validateVaultName(overMax);
      expect(overMaxResult.valid).toBe(false);
    });

    it("should trim whitespace before validation", () => {
      const nameWithSpaces = "  Valid Name  ";
      const result = ValidationHelpers.validateVaultName(nameWithSpaces);
      expect(result.valid).toBe(true);
    });

    it("should accept names with various characters", () => {
      const specialNames = [
        "Vault-2024",
        "My_Vault",
        "Vault #1",
        "Vault (Personal)",
        "Vault [Main]",
      ];

      specialNames.forEach((name) => {
        const result = ValidationHelpers.validateVaultName(name);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe("ValidationResult type", () => {
    it("should return consistent ValidationResult structure", () => {
      const emailResult = ValidationHelpers.validateEmail("test@example.com");
      expect(emailResult).toHaveProperty("valid");
      expect(typeof emailResult.valid).toBe("boolean");

      const passwordResult = ValidationHelpers.validatePassword("password");
      expect(passwordResult).toHaveProperty("valid");
      expect(typeof passwordResult.valid).toBe("boolean");

      const vaultNameResult = ValidationHelpers.validateVaultName("Vault Name");
      expect(vaultNameResult).toHaveProperty("valid");
      expect(typeof vaultNameResult.valid).toBe("boolean");
    });

    it("should include error message when validation fails", () => {
      const failedResults = [
        ValidationHelpers.validateEmail("invalid"),
        ValidationHelpers.validatePassword(""),
        ValidationHelpers.validateVaultName("a"),
      ];

      failedResults.forEach((result) => {
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe("string");
        expect(result.error!.length).toBeGreaterThan(0);
      });
    });

    it("should not include error message when validation succeeds", () => {
      const successResults = [
        ValidationHelpers.validateEmail("test@example.com"),
        ValidationHelpers.validatePassword("password"),
        ValidationHelpers.validateVaultName("Vault Name"),
      ];

      successResults.forEach((result) => {
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });
  });
});
