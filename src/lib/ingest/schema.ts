import { z } from "zod";

// Blueprint §5.2, §5.4, §8.2.

const text = (max: number) => z.string().trim().max(max).optional().nullable();

export const trackingFieldsSchema = z.object({
  utm_source: text(200),
  utm_medium: text(200),
  utm_campaign: text(300),
  utm_content: text(300),
  utm_term: text(300),
  gclid: text(512),
  gbraid: text(512),
  wbraid: text(512),
  fbclid: text(512),
  fbc: text(512),
  fbp: text(512),
  ttclid: text(512),
  msclkid: text(512),
  campaign_id: text(100),
  campaign_name: text(300),
  adset_id: text(100),
  adset_name: text(300),
  ad_id: text(100),
  ad_name: text(300),
  landing_page_url: text(2048),
  referrer: text(2048),
  page_title: text(300),
  occurred_at: z.iso.datetime({ offset: true }).optional().nullable(),
});

export const trackingSchema = trackingFieldsSchema.extend({
  session_id: text(100),
  anonymous_id: text(100),
  timezone: text(64),
  /** First touch kept by the SDK within the attribution window (§5.5). */
  first_touch: trackingFieldsSchema.optional().nullable(),
});

const answerValue = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(500)).max(50),
]);

export const leadRequestSchema = z.object({
  form_id: z.string().trim().max(100).optional().nullable(),
  lead: z.object({
    name: text(200),
    phone: text(40),
    email: text(254),
  }),
  answers: z
    .record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, "invalid answer key"), answerValue)
    .refine((a) => Object.keys(a).length <= 50, "at most 50 answers")
    .optional()
    .nullable(),
  tracking: trackingSchema.optional().nullable(),
  consent: z
    .object({
      privacy_policy: z.boolean().optional(),
      marketing: z.boolean().optional(),
      version: text(50),
      captured_at: z.iso.datetime({ offset: true }).optional().nullable(),
    })
    .optional()
    .nullable(),
  /** Honeypot: real visitors never fill this hidden field (§14.1). */
  website: z.string().max(500).optional().nullable(),
});

export type LeadRequest = z.infer<typeof leadRequestSchema>;
export type TrackingFields = z.infer<typeof trackingFieldsSchema>;
