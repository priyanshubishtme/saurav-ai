import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { htmlAuditRequestSchema, urlAuditRequestSchema } from "./schemas.js";
import { getScannerDiagnostics, scanAudit, scannerConfiguration } from "./scanner.js";
import { applyRepairSchema, controlledArtifactSchema, repairInputSchema, RepairError } from "./repairs/repairEngine.js";
import { repairService as defaultRepairService } from "./repairs/repairService.js";
import { createVerificationRecord, freezeSnapshot } from "./verification/engine.js";
import { buildAuditReport, renderAuditReportHtml } from "./reports/auditReport.js";
import { authService } from "./auth.js";
import { getDatabaseStatus } from "./database.js";
import { MongoAuditRepository } from "./auditRepository.js";

const apiError = (requestId, code, message, details) => ({
  error: {
    code,
    message,
    requestId,
    ...(details ? { details } : {}),
  },
});

function publicValidationIssues(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

function auditListItem(audit) {
  return {
    id: audit.id,
    source: audit.source,
    sourceType: audit.sourceType,
    projectName: audit.projectName,
    requestedUrl: audit.requestedUrl,
    finalUrl: audit.finalUrl,
    createdAt: audit.createdAt,
    durationMs: audit.durationMs,
    wcagLevel: audit.wcagLevel,
    engine: audit.engine,
    summary: audit.summary,
  };
}

function publicRepair(repair) {
  const safeRepair = { ...repair };
  delete safeRepair.baselineSnapshot;
  delete safeRepair.sourceArtifact;
  delete safeRepair.rollbackArtifact;
  delete safeRepair.appliedArtifact;
  return safeRepair;
}

function reportRepair(repair) {
  return {
    id: repair.id,
    auditId: repair.auditId,
    baselineAuditId: repair.baselineAuditId,
    violationId: repair.violationId,
    selector: repair.selector,
    originalCode: repair.originalCode,
    proposedCode: repair.proposedCode,
    explanation: repair.explanation,
    accessibilityRationale: repair.accessibilityRationale,
    expectedVerificationCriteria: repair.expectedVerificationCriteria ?? [],
    assumptions: repair.assumptions,
    source: repair.source,
    artifactId: repair.artifactId ?? null,
    artifactVersion: repair.artifactVersion ?? null,
    patchHash: repair.patchHash ?? null,
    approvedBy: repair.approvedBy ?? null,
    approvedAt: repair.approvedAt ?? null,
    status: repair.status,
    createdAt: repair.createdAt,
    acceptedAt: repair.acceptedAt ?? null,
    appliedAt: repair.appliedAt ?? null,
    verifiedAt: repair.verifiedAt ?? null,
    rejectedAt: repair.rejectedAt ?? null,
    rolledBackAt: repair.rolledBackAt ?? null,
    verificationStatus: repair.verificationStatus ?? null,
  };
}

function handleScanError(error, requestId, response) {
  if (error instanceof ZodError) {
    return response.status(400).json(
      apiError(requestId, "VALIDATION_ERROR", "The audit request is invalid.", publicValidationIssues(error)),
    );
  }

  if (error?.code && Number.isInteger(error.status)) {
    return response.status(error.status).json(apiError(requestId, error.code, error.message));
  }

  console.error("Unhandled scan error:", { requestId, name: error?.name, code: error?.code });
  return response.status(500).json(
    apiError(requestId, "INTERNAL_ERROR", "An unexpected server error occurred."),
  );
}

function handleRepairError(error, requestId, response) {
  if (error instanceof ZodError) {
    return response.status(400).json(
      apiError(requestId, "VALIDATION_ERROR", "The repair request is invalid.", publicValidationIssues(error)),
    );
  }
  if (error instanceof RepairError || error?.code && Number.isInteger(error.status)) {
    return response.status(error.status).json(apiError(requestId, error.code, error.message));
  }
  console.error("Unhandled repair error:", { requestId, name: error?.name, code: error?.code });
  return response.status(500).json(apiError(requestId, "INTERNAL_ERROR", "An unexpected server error occurred."));
}

export function createApp({
  scan = scanAudit,
  auditStore = new Map(),
  repairStore = new Map(),
  repairs = defaultRepairService,
  verificationStore = new Map(),
  artifactStore = new Map(),
  controlledArtifactStore = new Map(),
  auth = authService,
  repository = auth === authService ? new MongoAuditRepository() : null,
  storageName = repository ? "mongodb" : "in_memory",
} = {}) {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  const configuredOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  const allowedOrigins = process.env.NODE_ENV === "production"
    ? new Set([configuredOrigin])
    : new Set([configuredOrigin, "http://localhost:5173", "http://127.0.0.1:5173"]);
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true,
  }));
  app.use((request, response, next) => {
    request.requestId = randomUUID();
    response.set("X-Request-Id", request.requestId);
    next();
  });
  app.use(express.json({ limit: "350kb" }));
  app.locals.audits = auditStore;
  app.locals.repairs = repairStore;
  app.locals.verifications = verificationStore;
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

  class PersistenceError extends Error {
    constructor() {
      super("Saved data could not be reached. Try again.");
      this.code = "PERSISTENCE_UNAVAILABLE";
      this.status = 503;
    }
  }

  function trimAuditStore({
    audits = auditStore,
    repairs: scopedRepairs = repairStore,
    verifications: scopedVerifications = verificationStore,
  } = {}) {
    const referencedBaselines = new Set([
      ...[...scopedRepairs.values()].map((repair) => repair.baselineAuditId ?? repair.auditId),
      ...[...scopedVerifications.values()].flatMap((record) => [record.baselineAuditId, record.comparisonBaselineAuditId]),
    ]);
    while (audits.size > scannerConfiguration.storedAudits) {
      const removableId = [...audits.keys()].find((auditId) => !referencedBaselines.has(auditId));
      if (!removableId) break;
      audits.delete(removableId);
    }
  }

  app.get("/api/health", async (request, response) => {
    const scannerDiagnostic = await getScannerDiagnostics();
    const scannerStatus = scannerDiagnostic.status;
    const database = getDatabaseStatus();
    response.json({
      requestId: request.requestId,
      status: database.status === "unavailable" ? "degraded" : "ok",
      service: "accessz-api",
      capabilities: {
        accessibilityScanning: scannerStatus === "available" ? "playwright-axe-core" : "unavailable",
        aiSuggestions: repairs.getStatus(),
        authentication: auth.ready() ? "available" : "unavailable",
        auditPersistence: database.connected ? "mongodb" : "unavailable",
      },
      database: { status: database.status },
      scanner: {
        engine: "Playwright + Chromium + axe-core",
        wcagLevels: Object.keys(scannerConfiguration.tags),
        status: scannerStatus,
        diagnostic: scannerDiagnostic.message,
      },
    });
  });

  const sessionMiddleware = auth.sessionMiddleware();
  app.use("/api/auth", auth.requireReady);
  app.use("/api/auth", sessionMiddleware);
  app.post("/api/auth/register", auth.requireOrigin, auth.register);
  app.post("/api/auth/login", auth.requireOrigin, auth.loginLimiter, auth.login);
  app.get("/api/auth/me", auth.requireUser, auth.me);
  app.post("/api/auth/logout", auth.requireOrigin, auth.requireUser, auth.logout);

  app.use("/api", auth.requireReady);
  app.use("/api", sessionMiddleware);
  app.use("/api", auth.requireUser);
  app.use("/api", (request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
    return auth.requireOrigin(request, response, next);
  });
  app.use("/api", async (request, response, next) => {
    try {
      if (repository) {
        const workspace = await repository.loadWorkspace(request.user.id);
        const audits = new Map(workspace.audits.map((record) => [record.id, record]));
        const repairsForUser = new Map(workspace.repairs.map((record) => [record.id, record]));
        const verifications = new Map(workspace.verifications.map((record) => [record.id, record]));
        for (const repair of workspace.repairs) {
          if (repair.baselineSnapshot && !audits.has(repair.baselineAuditId ?? repair.auditId)) {
            audits.set(repair.baselineAuditId ?? repair.auditId, repair.baselineSnapshot);
          }
        }
        const artifacts = new Map();
        const controlledArtifacts = new Map((workspace.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
        const orderedRepairs = [...workspace.repairs].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        for (const repair of orderedRepairs) {
          if (repair.appliedArtifact && repair.status !== "rolled_back") artifacts.set(repair.auditId, repair.appliedArtifact);
          else if (repair.rollbackArtifact && repair.status === "rolled_back") artifacts.set(repair.auditId, repair.rollbackArtifact);
        }
        request.workspace = {
          audits,
          repairs: repairsForUser,
          verifications,
          artifacts,
          controlledArtifacts,
        };
      } else {
        request.workspace = {
          audits: auditStore,
          repairs: repairStore,
          verifications: verificationStore,
          artifacts: artifactStore,
          controlledArtifacts: controlledArtifactStore,
        };
      }
      next();
    } catch (error) {
      console.error("Could not load user workspace:", { requestId: request.requestId, name: error?.name, code: error?.code });
      response.status(503).json(apiError(request.requestId, "PERSISTENCE_UNAVAILABLE", "Your saved workspace is temporarily unavailable."));
    }
  });

  async function persistWorkspaceRecord(request, type, record) {
    if (!repository) return;
    try {
      if (type === "audit") await repository.saveAudit(request.user.id, record);
      if (type === "repair") await repository.saveRepair(request.user.id, record);
      if (type === "verification") await repository.saveVerification(request.user.id, record);
      if (type === "artifact") await repository.saveArtifact(request.user.id, record);
    } catch (error) {
      console.error("Could not save user workspace data:", { requestId: request.requestId, name: error?.name, code: error?.code });
      throw new PersistenceError();
    }
  }

  async function persistRepairAndArtifact(request, repair) {
    if (!repository) return;
    try {
      const artifact = request.workspace.controlledArtifacts.get(repair.artifactId);
      await repository.saveRepairAndArtifact(request.user.id, repair, artifact);
    } catch (error) {
      console.error("Could not save applied repair and artifact:", { requestId: request.requestId, name: error?.name, code: error?.code });
      throw new PersistenceError();
    }
  }

  app.get("/api/audits/", async (request, response) => {
    const { audits: auditRecords } = request.workspace;
    const rawLimit = request.query.limit ?? "25";
    const limit = Number(rawLimit);
    if (!/^\d+$/.test(String(rawLimit)) || limit < 1 || limit > 50) {
      return response.status(400).json(
        apiError(request.requestId, "VALIDATION_ERROR", "The audit-list limit must be between 1 and 50."),
      );
    }

    const audits = [...auditRecords.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(auditListItem);
    return response.json({ requestId: request.requestId, audits, count: audits.length, storage: storageName });
  });

  app.get("/api/artifacts/", (request, response) => {
    const artifacts = [...request.workspace.controlledArtifacts.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(({ id, name, auditId, version, createdAt, updatedAt }) => ({ id, name, auditId, version, createdAt, updatedAt }));
    return response.json({ requestId: request.requestId, artifacts, storage: storageName });
  });

  app.post("/api/artifacts/", async (request, response) => {
    const parsedRequest = controlledArtifactSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return response.status(400).json(apiError(request.requestId, "VALIDATION_ERROR", "The controlled HTML artifact is invalid.", publicValidationIssues(parsedRequest.error)));
    }
    let { html } = parsedRequest.data;
    let auditId = null;
    if (parsedRequest.data.sourceAuditId) {
      const sourceAudit = request.workspace.audits.get(parsedRequest.data.sourceAuditId);
      if (!sourceAudit || sourceAudit.sourceType !== "html" || !sourceAudit.previewHtml) {
        return response.status(404).json(apiError(request.requestId, "AUDIT_NOT_FOUND", "Only an owned pasted-HTML audit can be used as an artifact source."));
      }
      html = sourceAudit.previewHtml;
      auditId = sourceAudit.id;
    }
    const now = new Date().toISOString();
    const artifact = {
      id: randomUUID(),
      name: parsedRequest.data.name,
      html,
      auditId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await persistWorkspaceRecord(request, "artifact", artifact);
    } catch (error) {
      return response.status(error.status ?? 503).json(apiError(request.requestId, error.code ?? "PERSISTENCE_UNAVAILABLE", error.message));
    }
    request.workspace.controlledArtifacts.set(artifact.id, artifact);
    return response.status(201).json({ requestId: request.requestId, artifact });
  });

  app.get("/api/artifacts/:artifactId/download", (request, response) => {
    const artifact = request.workspace.controlledArtifacts.get(request.params.artifactId);
    if (!artifact) return response.status(404).json(apiError(request.requestId, "ARTIFACT_NOT_FOUND", "This controlled artifact is no longer available."));
    response.set({
      "Content-Disposition": `attachment; filename="accessz-${artifact.id}.html"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
    return response.type("html").send(artifact.html);
  });

  app.get("/api/artifacts/:artifactId", (request, response) => {
    const artifact = request.workspace.controlledArtifacts.get(request.params.artifactId);
    if (!artifact) return response.status(404).json(apiError(request.requestId, "ARTIFACT_NOT_FOUND", "This controlled artifact is no longer available."));
    return response.json({ requestId: request.requestId, artifact });
  });

  app.get("/api/audits/:auditId", (request, response) => {
    const audit = request.workspace.audits.get(request.params.auditId);
    if (!audit) {
      return response.status(404).json(
        apiError(request.requestId, "AUDIT_NOT_FOUND", "This audit is no longer available."),
      );
    }
    return response.json({ requestId: request.requestId, audit, storage: storageName });
  });

  app.get("/api/audits/:auditId/verifications", (request, response) => {
    const { audits: auditStore, verifications: verificationStore } = request.workspace;
    const audit = auditStore.get(request.params.auditId);
    if (!audit) {
      return response.status(404).json(apiError(request.requestId, "AUDIT_NOT_FOUND", "This audit is no longer available."));
    }
    const verifications = [...verificationStore.values()]
      .filter((record) => record.baselineAuditId === audit.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return response.json({ requestId: request.requestId, verifications, storage: storageName });
  });

  app.get("/api/audits/:auditId/repairs", (request, response) => {
    const { audits: auditStore, repairs: repairStore } = request.workspace;
    const audit = auditStore.get(request.params.auditId);
    if (!audit) return response.status(404).json(apiError(request.requestId, "AUDIT_NOT_FOUND", "This audit is no longer available."));
    const records = [...repairStore.values()].filter((repair) => repair.auditId === audit.id).map(publicRepair);
    return response.json({ requestId: request.requestId, repairs: records, storage: storageName });
  });

  app.get("/api/audits/:auditId/report.json", (request, response) => {
    const { audits: auditStore, repairs: repairStore, verifications: verificationStore } = request.workspace;
    const audit = auditStore.get(request.params.auditId);
    if (!audit) return response.status(404).json(apiError(request.requestId, "AUDIT_NOT_FOUND", "This audit is no longer available."));
    const repairsForAudit = [...repairStore.values()].filter((repair) => repair.auditId === audit.id).map(reportRepair);
    const repairIds = new Set(repairsForAudit.map((repair) => repair.id));
    const verifications = [...verificationStore.values()].filter((record) => record.baselineAuditId === audit.id || repairIds.has(record.repairId));
    const report = buildAuditReport({ audit, repairs: repairsForAudit, verifications });
    response.set("Content-Disposition", `attachment; filename="accessz-audit-${audit.id}.json"`);
    return response.json(report);
  });

  app.get("/api/audits/:auditId/report.html", (request, response) => {
    const { audits: auditStore, repairs: repairStore, verifications: verificationStore } = request.workspace;
    const audit = auditStore.get(request.params.auditId);
    if (!audit) return response.status(404).json(apiError(request.requestId, "AUDIT_NOT_FOUND", "This audit is no longer available."));
    const repairsForAudit = [...repairStore.values()].filter((repair) => repair.auditId === audit.id).map(reportRepair);
    const repairIds = new Set(repairsForAudit.map((repair) => repair.id));
    const verifications = [...verificationStore.values()].filter((record) => record.baselineAuditId === audit.id || repairIds.has(record.repairId));
    const report = buildAuditReport({ audit, repairs: repairsForAudit, verifications });
    response.type("html").set("Content-Disposition", `attachment; filename="accessz-audit-${audit.id}.html"`);
    return response.send(renderAuditReportHtml(report));
  });

  app.post("/api/repairs/suggest", async (request, response) => {
    const { audits: auditStore, repairs: repairStore, controlledArtifacts } = request.workspace;
    const parsedRequest = repairInputSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return response.status(400).json(
        apiError(request.requestId, "VALIDATION_ERROR", "The repair request is invalid.", publicValidationIssues(parsedRequest.error)),
      );
    }
    try {
      const repair = await repairs.suggest({
        auditStore,
        repairStore,
        controlledArtifacts,
        input: { ...parsedRequest.data, requestId: request.requestId },
      });
      await persistWorkspaceRecord(request, "repair", repair);
      while (repairStore.size > 100) repairStore.delete(repairStore.keys().next().value);
      return response.status(201).json({ requestId: request.requestId, repair: publicRepair(repair) });
    } catch (error) {
      return handleRepairError(error, request.requestId, response);
    }
  });

  app.post("/api/repairs/:repairId/apply", async (request, response) => {
    const { audits: auditStore, repairs: repairStore, artifacts: artifactStore, controlledArtifacts } = request.workspace;
    const parsedRequest = applyRepairSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return response.status(400).json(
        apiError(request.requestId, "VALIDATION_ERROR", "Repair approval is required.", publicValidationIssues(parsedRequest.error)),
      );
    }
    try {
      const repair = repairs.apply({
        auditStore,
        repairStore,
        artifactStore,
        controlledArtifacts,
        repairId: request.params.repairId,
        approvedBy: request.user.id,
        ...parsedRequest.data,
      });
      await persistRepairAndArtifact(request, repair);
      return response.json({ requestId: request.requestId, repair: publicRepair(repair) });
    } catch (error) {
      if (error?.name === "MongoServerError" || error?.name === "MongoNetworkError") {
        return response.status(503).json(apiError(request.requestId, "PERSISTENCE_UNAVAILABLE", "The repair could not be saved. Try again."));
      }
      return handleRepairError(error, request.requestId, response);
    }
  });

  app.post("/api/repairs/:repairId/reject", async (request, response) => {
    const { repairs: repairStore } = request.workspace;
    try {
      const repair = repairs.reject({ repairStore, repairId: request.params.repairId });
      await persistWorkspaceRecord(request, "repair", repair);
      return response.json({ requestId: request.requestId, repair: publicRepair(repair) });
    } catch (error) {
      if (error?.name === "MongoServerError" || error?.name === "MongoNetworkError") {
        return response.status(503).json(apiError(request.requestId, "PERSISTENCE_UNAVAILABLE", "The repair could not be saved. Try again."));
      }
      return handleRepairError(error, request.requestId, response);
    }
  });

  app.post("/api/repairs/:repairId/rollback", async (request, response) => {
    const { repairs: repairStore, artifacts: artifactStore, controlledArtifacts } = request.workspace;
    try {
      const repair = repairs.rollback({ repairStore, artifactStore, controlledArtifacts, repairId: request.params.repairId });
      await persistRepairAndArtifact(request, repair);
      return response.json({ requestId: request.requestId, repair: publicRepair(repair) });
    } catch (error) {
      if (error?.name === "MongoServerError" || error?.name === "MongoNetworkError") {
        return response.status(503).json(apiError(request.requestId, "PERSISTENCE_UNAVAILABLE", "The rollback could not be saved. Try again."));
      }
      return handleRepairError(error, request.requestId, response);
    }
  });

  async function performVerification({
    baseline,
    baselineInput = null,
    input,
    scope,
    repair = null,
    environmentalChange = false,
    request,
    response,
  }) {
    const {
      audits: auditStore,
      verifications: verificationStore,
    } = request.workspace;
    let followUp;
    let comparisonBaseline = baseline;
    let baselineScanStatus = baselineInput ? "failed" : "not_run";
    let scanError;
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const abortOnDisconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once("close", abortOnDisconnect);
    request.once("aborted", abortOnDisconnect);
    try {
      if (baselineInput) {
        comparisonBaseline = await scan(baselineInput, { signal: controller.signal });
        if (comparisonBaseline?.status !== "completed") {
          comparisonBaseline = baseline;
          scanError = { code: "BASELINE_SCAN_FAILED", message: "The controlled baseline scan did not complete successfully.", status: 502 };
          throw new Error("Controlled baseline scan did not complete.");
        }
        baselineScanStatus = "completed";
        auditStore.set(comparisonBaseline.id, comparisonBaseline);
      }
      followUp = await scan(input, { signal: controller.signal });
      if (followUp?.status !== "completed") {
        followUp = null;
        scanError = { code: "SCAN_NOT_COMPLETED", message: "The follow-up scan did not complete successfully.", status: 502 };
        throw new Error("Follow-up scan did not complete.");
      }
      auditStore.set(followUp.id, followUp);
    } catch (error) {
      scanError ??= error?.code && Number.isInteger(error.status)
        ? error
        : { code: "SCANNER_FAILED", message: "The follow-up scan could not be completed.", status: 502 };
    } finally {
      response.removeListener("close", abortOnDisconnect);
      request.removeListener("aborted", abortOnDisconnect);
    }
    const record = createVerificationRecord({
      baseline: comparisonBaseline,
      followUp,
      scanError,
      startedAt,
      baselineAuditId: baseline.id,
      sourceAuditScore: baseline.summary.score,
      baselineScanStatus,
      scope,
      repair,
      repairId: repair?.id ?? null,
      environmentalChange,
    });
    if (repair) {
      repair.verificationIds ??= [];
      repair.verificationIds.push(record.id);
      repair.verificationStatus = record.status;
      if (record.status === "verified") repair.status = "verified";
      else if (repair.status !== "rolled_back") repair.status = "needs_review";
      repair.verifiedAt = record.status === "verified" ? record.completedAt : null;
    }
    try {
      if (comparisonBaseline !== baseline) await persistWorkspaceRecord(request, "audit", comparisonBaseline);
      if (followUp) await persistWorkspaceRecord(request, "audit", followUp);
      await persistWorkspaceRecord(request, "verification", record);
      if (repair) await persistWorkspaceRecord(request, "repair", repair);
    } catch (error) {
      return response.status(error.status ?? 503).json(apiError(request.requestId, error.code ?? "PERSISTENCE_UNAVAILABLE", error.message));
    }
    verificationStore.set(record.id, record);
    while (verificationStore.size > 200) verificationStore.delete(verificationStore.keys().next().value);
    trimAuditStore(request.workspace);
    if (scanError) {
      return response.status(Number.isInteger(scanError.status) ? scanError.status : 502).json({
        ...apiError(request.requestId, record.error.code, record.error.message),
        verification: record,
      });
    }
    return response.status(201).json({ requestId: response.getHeader("X-Request-Id"), verification: record, audit: followUp });
  }

  app.post("/api/repairs/:repairId/verify", async (request, response) => {
    const { repairs: repairStore } = request.workspace;
    const repair = repairStore.get(request.params.repairId);
    if (!repair) return response.status(404).json(apiError(request.requestId, "REPAIR_NOT_FOUND", "This repair is no longer available."));
    if (!["applied", "needs_review", "verified"].includes(repair.status) || !repair.appliedArtifact) {
      return response.status(409).json(apiError(request.requestId, "REPAIR_NOT_APPLIED", "Apply the repair to its controlled artifact before verifying it."));
    }
    const baseline = repair.baselineSnapshot;
    if (!baseline) return response.status(409).json(apiError(request.requestId, "BASELINE_UNAVAILABLE", "The immutable baseline snapshot is not available."));
    const input = {
      sourceType: "html",
      html: repair.appliedArtifact,
      projectName: `${baseline.projectName ?? "Audit"} · repair verification`,
      wcagLevel: baseline.wcagLevel,
      includeBestPractices: baseline.includeBestPractices,
    };
    const baselineInput = {
      ...input,
      html: repair.sourceArtifact,
      projectName: `${baseline.projectName ?? "Audit"} · controlled baseline`,
    };
    return performVerification({
      baseline,
      baselineInput,
      input,
      scope: baseline.sourceType === "url" ? "controlled_element_snapshot" : "controlled_html_snapshot",
      repair,
      request,
      response,
    });
  });

  app.post("/api/audits/:auditId/verify", async (request, response) => {
    const { audits: auditStore, repairs: repairStore, artifacts: artifactStore } = request.workspace;
    const baseline = auditStore.get(request.params.auditId);
    if (!baseline) return response.status(404).json(apiError(request.requestId, "AUDIT_NOT_FOUND", "This audit is no longer available."));
    const controlledArtifact = artifactStore.get(baseline.id);
    const urlRepairs = [...repairStore.values()].filter((repair) => repair.auditId === baseline.id && repair.sourceArtifact);
    const controlledUrlBaseline = baseline.sourceType === "url" && controlledArtifact ? urlRepairs[0]?.sourceArtifact : null;
    const useControlledHtml = Boolean(controlledArtifact) || baseline.sourceType === "html";
    const input = useControlledHtml
      ? {
          sourceType: "html",
          html: controlledArtifact ?? baseline.previewHtml,
          projectName: `${baseline.projectName ?? "Audit"} · full verification`,
          wcagLevel: baseline.wcagLevel,
          includeBestPractices: baseline.includeBestPractices,
        }
      : {
          sourceType: "url",
          url: baseline.requestedUrl,
          wcagLevel: baseline.wcagLevel,
          includeBestPractices: baseline.includeBestPractices,
        };
    return performVerification({
      baseline: freezeSnapshot(baseline),
      ...(controlledUrlBaseline ? {
        baselineInput: {
          sourceType: "html",
          html: controlledUrlBaseline,
          projectName: `${baseline.projectName ?? "Audit"} · controlled baseline`,
          wcagLevel: baseline.wcagLevel,
          includeBestPractices: baseline.includeBestPractices,
        },
      } : {}),
      input,
      scope: useControlledHtml ? (baseline.sourceType === "url" ? "controlled_element_snapshot" : "controlled_html_snapshot") : "live_url_rescan",
      environmentalChange: !useControlledHtml,
      request,
      response,
    });
  });

  async function submitAudit(request, response, schema, sourceType) {
    const parsedRequest = schema.safeParse(request.body);
    if (!parsedRequest.success) {
      return response.status(400).json(
        apiError(
          request.requestId,
          "VALIDATION_ERROR",
          "The audit request is invalid.",
          publicValidationIssues(parsedRequest.error),
        ),
      );
    }

    const controller = new AbortController();
    const handleAbortedRequest = () => controller.abort();
    request.once("aborted", handleAbortedRequest);
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });

    try {
      const input = sourceType === "url"
        ? { sourceType, ...parsedRequest.data }
        : { sourceType, ...parsedRequest.data };
      const audit = await scan(input, { signal: controller.signal, requestId: request.requestId });
      const { audits: auditStore } = request.workspace;
      auditStore.set(audit.id, audit);
      await persistWorkspaceRecord(request, "audit", audit);
      if (audit.sourceType === "html" && audit.previewHtml) {
        const now = new Date().toISOString();
        const artifact = {
          id: randomUUID(),
          name: audit.projectName ?? "Pasted HTML audit source",
          html: audit.previewHtml,
          auditId: audit.id,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await persistWorkspaceRecord(request, "artifact", artifact);
        request.workspace.controlledArtifacts.set(artifact.id, artifact);
      }
      trimAuditStore(request.workspace);
      return response.status(201).json({ requestId: request.requestId, audit, storage: storageName });
    } catch (error) {
      return handleScanError(error, request.requestId, response);
    } finally {
      request.removeListener("aborted", handleAbortedRequest);
    }
  }

  app.post("/api/audits/url", (request, response) => submitAudit(request, response, urlAuditRequestSchema, "url"));
  app.post("/api/audits/html", (request, response) => submitAudit(request, response, htmlAuditRequestSchema, "html"));

  app.use((_request, response) => {
    response.status(404).json(apiError(response.getHeader("X-Request-Id"), "NOT_FOUND", "This API route does not exist."));
  });

  app.use((error, request, response, _next) => {
    if (error instanceof SyntaxError && "body" in error) {
      return response.status(400).json(
        apiError(request.requestId, "INVALID_JSON", "The request body must be valid JSON."),
      );
    }
    if (error?.type === "entity.too.large") {
      return response.status(413).json(
        apiError(request.requestId, "PAYLOAD_TOO_LARGE", "The request body exceeds the allowed size."),
      );
    }
    if (error?.type === "entity.parse.failed") {
      return response.status(400).json(
        apiError(request.requestId, "INVALID_JSON", "The request body must be valid JSON."),
      );
    }

    console.error("Unhandled API error:", { requestId: request.requestId, name: error?.name, code: error?.code });
    return response.status(500).json(
      apiError(request.requestId, "INTERNAL_ERROR", "An unexpected server error occurred."),
    );
  });

  return app;
}
