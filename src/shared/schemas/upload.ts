import { z } from "zod";

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB
export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

export const avatarUploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine(
      (file) => (ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type),
      "File must be a JPEG, PNG, GIF, or WebP image",
    )
    .refine(
      (file) => file.size <= MAX_AVATAR_SIZE,
      "File must be smaller than 2MB",
    ),
});

export const uploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((file) => file.size <= MAX_UPLOAD_SIZE, "File must be smaller than 5MB"),
});

export type AvatarUploadInput = z.infer<typeof avatarUploadSchema>;
export type UploadInput = z.infer<typeof uploadSchema>;
