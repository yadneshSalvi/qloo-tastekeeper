import { z } from 'zod';
export const clientIdSchema = z.enum(['books', 'media', 'places']);
export const fieldSchema = z.enum(['id', 'title', 'description', 'creator', 'url', 'price']);
export const constraintsSchema = z
  .object({
    maxPrice: z.number().int().min(0).max(100000).optional(),
    format: z.enum(['any', 'paperback', 'hardback', 'ebook']).optional(),
    maxMinutes: z.number().int().min(1).max(600).optional(),
    setting: z.enum(['any', 'indoors', 'outdoors']).optional(),
  })
  .strict();
export const briefSchema = z
  .object({
    occasion: z.enum(['birthday', 'thank_you', 'just_because', 'for_me']),
    note: z.string().trim().max(240).optional(),
  })
  .strict();
export const referenceSearchSchema = z
  .object({
    query: z.string().trim().min(2).max(100),
    type: z.enum(['book', 'movie', 'place', 'person', 'artist']),
  })
  .strict();
export const addReferenceSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    searchId: z.uuid(),
    candidateId: z.uuid(),
  })
  .strict();
export const decisionSchema = z
  .object({
    grantId: z.uuid(),
    contextId: z.uuid(),
    purpose: z.enum(['gift', 'personal']),
    operation: z.literal('rank'),
    targetType: z.enum(['book', 'movie', 'place']),
    snapshotId: z.uuid(),
    candidateIds: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length, 'Candidates must be distinct.'),
    fields: z
      .array(fieldSchema)
      .min(1)
      .max(6)
      .refine((v) => new Set(v).size === v.length, 'Fields must be distinct.'),
    hardConstraints: constraintsSchema,
    idempotencyKey: z.uuid(),
    mode: z.enum(['sample', 'qloo']),
    brief: briefSchema.optional(),
  })
  .strict();
export const invitationSchema = z
  .object({
    contextId: z.uuid(),
    clientId: clientIdSchema,
    purpose: z.enum(['gift', 'personal']),
    signalIds: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length),
    expiresInHours: z.number().int().min(1).max(24),
    requestLimit: z.number().int().min(1).max(40),
    snapshotMode: z.enum(['pinned', 'follow_current']),
    delegateName: z.string().trim().min(1).max(40),
    acknowledged: z.literal(true),
  })
  .strict();
export const correctionSchema = z
  .object({
    contextId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    removeSignalIds: z.array(z.string().min(1).max(80)).min(1).max(10),
    reason: z.enum([
      'no_longer_interested',
      'wrong_reference',
      'wrong_situation',
      'already_know_it',
    ]),
  })
  .strict();
export const contextCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    purpose: z.enum(['personal', 'gift']),
    referenceIds: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export type DecisionInput = z.infer<typeof decisionSchema>;
export type InvitationInput = z.infer<typeof invitationSchema>;
export type CorrectionInput = z.infer<typeof correctionSchema>;
export type HardConstraints = z.infer<typeof constraintsSchema>;
export const PUBLIC_FIELDS = ['id', 'title', 'description', 'creator', 'url', 'price'] as const;
export type WorkflowStatus = 'ok' | 'empty' | 'needs_input' | 'partial' | 'degraded' | 'error';
