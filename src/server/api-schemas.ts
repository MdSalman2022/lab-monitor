import { z } from "zod";

export const userIdSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const userUpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(80).optional(),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const sessionIdSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
});

export const scheduleCreateSchema = z.object({
  userId: z.coerce.number().int().positive(),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
});

export const scheduleUpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive().optional(),
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  isActive: z.boolean().optional(),
});

export const scheduleDeleteSchema = z.object({
  id: z.coerce.number().int().positive(),
});
