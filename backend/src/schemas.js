import { z } from "zod";

const auditOptionsSchema = {
  wcagLevel: z.enum(["A", "AA", "AAA"]).default("AA"),
  includeBestPractices: z.boolean().default(true),
};

const additionalCssSchema = z.string().min(1).max(100_000).refine(
  (value) => Buffer.byteLength(value, "utf8") <= 100_000
    && !/@import\b|expression\s*\(|<\/style|javascript:/i.test(value),
  "Additional CSS must be 100,000 bytes or fewer and cannot contain active imports or script-like content.",
).optional();

export const urlAuditRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048).url(),
  additionalCss: additionalCssSchema,
  ...auditOptionsSchema,
}).strict();

export const htmlAuditRequestSchema = z.object({
  html: z.string().min(1).max(300_000).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 300_000,
    "HTML must be 300,000 bytes or fewer.",
  ),
  projectName: z.string().trim().max(100).optional(),
  additionalCss: additionalCssSchema,
  ...auditOptionsSchema,
}).strict().refine(
  (value) => Buffer.byteLength(value.html, "utf8") + Buffer.byteLength(value.additionalCss ?? "", "utf8") <= 300_000,
  "HTML and additional CSS must total 300,000 bytes or fewer.",
);

export const violationSchema = z.object({
  id: z.string(),
  impact: z.enum(["critical", "serious", "moderate", "minor"]).nullable(),
  description: z.string(),
  help: z.string(),
  helpUrl: z.string().url(),
  tags: z.array(z.string()),
  wcagCriteria: z.array(z.string()),
  nodeCount: z.number().int().nonnegative(),
  nodesTruncated: z.boolean(),
  nodes: z.array(z.object({
    targets: z.array(z.string()),
    selector: z.string(),
    html: z.string(),
    failureSummary: z.string(),
    any: z.array(z.unknown()),
    all: z.array(z.unknown()),
    none: z.array(z.unknown()),
    relatedNodes: z.array(z.object({
      targets: z.array(z.string()),
      html: z.string(),
      failureSummary: z.string(),
    })),
  })),
});

export const auditSchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  sourceType: z.enum(["url", "html"]),
  status: z.literal("completed"),
  summary: z.object({
    score: z.number().min(0).max(100).nullable(),
    violations: z.number().int().nonnegative(),
    passes: z.number().int().nonnegative(),
    incomplete: z.number().int().nonnegative(),
    inapplicable: z.number().int().nonnegative(),
  }),
  violations: z.array(violationSchema),
  passes: z.array(violationSchema),
  incomplete: z.array(violationSchema),
  inapplicable: z.array(violationSchema),
  createdAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
});

export const repairSchema = z.object({
  id: z.string(),
  violationId: z.string(),
  originalCode: z.string(),
  proposedCode: z.string(),
  status: z.enum(["proposed", "accepted", "rejected"]),
});

export const verificationResultSchema = z.object({
  auditId: z.string(),
  beforeScore: z.number().min(0).max(100).nullable(),
  afterScore: z.number().min(0).max(100).nullable(),
  resolvedViolationIds: z.array(z.string()),
  remainingViolationIds: z.array(z.string()),
  regressionViolationIds: z.array(z.string()),
});
