import { describe, expect, it } from "vitest";

import { businessSignupSchema, loginSchema, personalSignupSchema, recoverySchema, resetPasswordSchema } from "./auth-validation";

const credentials = { email: "user@example.com", password: "password123", confirmPassword: "password123" };

describe("auth validation", () => {
  it("rejects an invalid login email", () => {
    expect(loginSchema.safeParse({ email: "bad", password: "password123" }).success).toBe(false);
  });
  it("accepts a lowercase Latin username", () => {
    expect(personalSignupSchema.safeParse({ ...credentials, username: "arownd.user" }).success).toBe(true);
  });
  it("normalizes username casing", () => {
    expect(personalSignupSchema.parse({ ...credentials, username: "Arownd.User" }).username).toBe("arownd.user");
  });
  it("rejects Arabic characters and spaces in usernames", () => {
    for (const username of ["أمين", "arownd user", "ab", "a..b", ".arownd"]) {
      expect(personalSignupSchema.safeParse({ ...credentials, username }).success).toBe(false);
    }
  });
  it("rejects mismatched passwords", () => {
    expect(personalSignupSchema.safeParse({ ...credentials, username: "arownd.user", confirmPassword: "different123" }).success).toBe(false);
  });
  it("requires a business name for merchant signup", () => {
    expect(businessSignupSchema.safeParse({ ...credentials, username: "merchant.user", businessName: "" }).success).toBe(false);
  });
  it("validates password recovery email", () => {
    expect(recoverySchema.safeParse({ email: "person@example.com" }).success).toBe(true);
  });
  it("validates a password reset confirmation", () => {
    expect(resetPasswordSchema.safeParse({ password: "newpassword123", confirmPassword: "newpassword123" }).success).toBe(true);
  });
});
