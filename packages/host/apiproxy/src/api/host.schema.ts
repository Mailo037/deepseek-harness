/**
 * host domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { DirectoryEntry, HostRepository, UpdateLatestCommit } from './host.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** host.describe request payload (empty object literal). */
export const hostDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.describe'>>>

/** Repository identity row of the describe value. */
export const hostRepositorySchema = z.object({
  branch: z.string(),
  commit: z.string(),
  remoteUrl: z.string().nullable(),
}) satisfies z.ZodType<Wire<HostRepository>>

/** host.describe response value. */
export const hostDescribeValueSchema = z.object({
  version: z.string(),
  cwd: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  attachedSessions: z.number().int().nonnegative(),
  home: z.string(),
  canOpenPath: z.boolean(),
  repository: hostRepositorySchema.nullable(),
  canRestart: z.boolean(),
  surface: z.union([z.literal('web'), z.literal('electron')]),
}) satisfies z.ZodType<Wire<ResponseValue<'host.describe'>>>

/** host.checkUpdate request payload; `force` bypasses the host's result cache. */
export const hostCheckUpdateRequestSchema = z.object({
  force: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'host.checkUpdate'>>>

/** Newest upstream commit row of the check value. */
export const updateLatestCommitSchema = z.object({
  commit: z.string(),
  subject: z.string(),
}) satisfies z.ZodType<Wire<UpdateLatestCommit>>

/** host.checkUpdate response value. */
export const hostCheckUpdateValueSchema = z.object({
  available: z.boolean(),
  branch: z.string(),
  commit: z.string(),
  upstream: z.string(),
  behind: z.number().int().nonnegative(),
  latest: updateLatestCommitSchema.nullable(),
  checkedAt: z.number(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.checkUpdate'>>>

/** host.applyUpdate request payload (empty object literal). */
export const hostApplyUpdateRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.applyUpdate'>>>

/** host.applyUpdate response value. */
export const hostApplyUpdateValueSchema = z.object({
  started: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'host.applyUpdate'>>>

/** host.pickDirectory request payload (empty object literal). */
export const hostPickDirectoryRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.pickDirectory'>>>

/** host.pickDirectory response value; null means the user cancelled. */
export const hostPickDirectoryValueSchema = z.object({
  path: z.string().nullable(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.pickDirectory'>>>

/** Directory row shared by listing entries and breadcrumb crumbs. */
export const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  hidden: z.boolean(),
}) satisfies z.ZodType<Wire<DirectoryEntry>>

/** host.listDirectory request payload; an absent path lists the home directory. */
export const hostListDirectoryRequestSchema = z.object({
  path: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'host.listDirectory'>>>

/** host.listDirectory response value. */
export const hostListDirectoryValueSchema = z.object({
  path: z.string(),
  home: z.string(),
  crumbs: z.array(directoryEntrySchema),
  entries: z.array(directoryEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.listDirectory'>>>

/** host.createDirectory request payload: name must be one plain path segment. */
export const hostCreateDirectoryRequestSchema = z.object({
  path: z.string(),
  name: z.string(),
}).refine(
  payload => payload.name.trim() !== '' && payload.name !== '.' && payload.name !== '..'
    && !/[/\\]/.test(payload.name),
  { message: 'host.createDirectory requires a single non-blank path segment name' },
) satisfies z.ZodType<Wire<RequestPayload<'host.createDirectory'>>>

/** host.createDirectory response value: the created directory's absolute path. */
export const hostCreateDirectoryValueSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.createDirectory'>>>
/** host.openPath request payload. */
export const hostOpenPathRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.openPath'>>>

/** host.openPath response value. */
export const hostOpenPathValueSchema = z.object({
  opened: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'host.openPath'>>>
