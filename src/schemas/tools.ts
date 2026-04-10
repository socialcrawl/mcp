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
}).strict();

export const GetDocsInputSchema = z.object({
  topic: z
    .string()
    .optional()
    .default("overview")
    .describe("Documentation topic: 'overview', 'full', 'authentication', 'credits', 'errors', or a platform slug (e.g., 'tiktok')"),
}).strict();
