import { z } from "zod";
import { getAllPlatformSlugs } from "../data/platforms.js";

const platformSlugs = getAllPlatformSlugs();

export const ListPlatformsInputSchema = z.object({}).strict();

export const ListEndpointsInputSchema = z.object({
  platform: z
    .enum(platformSlugs as [string, ...string[]])
    .describe("Platform slug (e.g., 'tiktok', 'instagram', 'youtube')"),
}).strict();

export const RequestInputSchema = z.object({
  platform: z
    .enum(platformSlugs as [string, ...string[]])
    .describe("Platform slug (e.g., 'tiktok', 'instagram', 'youtube')"),
  resource: z
    .string()
    .min(1, "Resource path is required")
    .describe("Resource path (e.g., 'profile', 'post/comments', 'search')"),
  params: z
    .record(z.string())
    .optional()
    .describe("Query parameters as key-value pairs (e.g., { handle: 'charlidamelio' })"),
  idempotencyKey: z
    .string()
    .min(16, "Idempotency-Key should be at least 16 characters (UUIDv4 recommended)")
    .optional()
    .describe(
      "Optional Idempotency-Key header. Lets you safely retry the same request — replays return the original response and deduct 0 credits (24h TTL).",
    ),
}).strict();

export const CheckBalanceInputSchema = z.object({}).strict();

export const GetDocsInputSchema = z.object({
  topic: z
    .string()
    .optional()
    .default("overview")
    .describe(
      "Documentation topic: 'overview', 'full', 'authentication', 'credits', 'errors', 'idempotency', or a platform slug (e.g., 'tiktok')",
    ),
}).strict();
