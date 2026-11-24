import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .min(1, "required")
  .email("invalidEmail");

const passwordSchema = z
  .string()
  .min(8, "passwordMin");

const reservedUsernames = ["admin", "administrator", "api", "auth", "console", "help", "login", "logout", "profile", "register", "settings", "signup", "support", "store", "stores", "www", "null"] as const;

export const usernameSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, "usernameInvalid")
  .min(3, "usernameInvalid")
  .max(30, "usernameInvalid")
  .refine((value) => !reservedUsernames.includes(value as typeof reservedUsernames[number]), "usernameReserved");

const signupBaseSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string().min(1, "required")
});

const matchingPasswords = {
  path: ["confirmPassword"],
  message: "passwordMismatch"
};

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "required")
});

export const personalSignupSchema = signupBaseSchema.refine(
  (value) => value.password === value.confirmPassword,
  matchingPasswords
);

export const businessSignupSchema = signupBaseSchema
  .extend({
    businessName: z.string().trim().min(2, "businessNameRequired")
  })
  .refine(
    (value) => value.password === value.confirmPassword,
    matchingPasswords
  );

export const recoverySchema = z.object({
  email: emailSchema
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "required")
  })
  .refine(
    (value) => value.password === value.confirmPassword,
    matchingPasswords
  );

export type LoginInput = z.infer<typeof loginSchema>;
export type PersonalSignupInput = z.infer<typeof personalSignupSchema>;
export type BusinessSignupInput = z.infer<typeof businessSignupSchema>;
export type RecoveryInput = z.infer<typeof recoverySchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;