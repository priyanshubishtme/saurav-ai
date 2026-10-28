import mongoose from "mongoose";
import { ArtifactRecord, AuditRecord, RepairRecord, VerificationRecord } from "./models.js";

const WORKSPACE_AUDIT_LIMIT = 50;
const WORKSPACE_REPAIR_LIMIT = 100;
const WORKSPACE_VERIFICATION_LIMIT = 200;

function recordData(record) {
  return record?.data ? structuredClone(record.data) : null;
}

export class MongoAuditRepository {
  async loadWorkspace(userId) {
    const [audits, repairs, verifications, artifacts] = await Promise.all([
      AuditRecord.find({ userId }).sort({ createdAt: -1 }).limit(WORKSPACE_AUDIT_LIMIT).lean(),
      RepairRecord.find({ userId }).sort({ createdAt: -1 }).limit(WORKSPACE_REPAIR_LIMIT).lean(),
      VerificationRecord.find({ userId }).sort({ createdAt: -1 }).limit(WORKSPACE_VERIFICATION_LIMIT).lean(),
      ArtifactRecord.find({ userId }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    return {
      audits: audits.map(recordData),
      repairs: repairs.map(recordData),
      verifications: verifications.map(recordData),
      artifacts: artifacts.map(recordData),
    };
  }

  async saveAudit(userId, audit) {
    await AuditRecord.updateOne(
      { userId, recordId: audit.id },
      { $set: { data: audit, createdAt: new Date(audit.createdAt) }, $setOnInsert: { userId, recordId: audit.id } },
      { upsert: true, runValidators: true, timestamps: false },
    );
    return audit;
  }

  async getAudit(userId, auditId) {
    return recordData(await AuditRecord.findOne({ userId, recordId: auditId }).lean());
  }

  async listAudits(userId, { limit = 25, before = null } = {}) {
    const filter = { userId };
    if (before) filter.createdAt = { $lt: new Date(before) };
    const records = await AuditRecord.find(filter).sort({ createdAt: -1, recordId: -1 }).limit(limit).lean();
    return records.map(recordData);
  }

  async saveRepair(userId, repair) {
    await RepairRecord.updateOne(
      { userId, recordId: repair.id },
      { $set: { data: repair, createdAt: new Date(repair.createdAt) }, $setOnInsert: { userId, recordId: repair.id } },
      { upsert: true, runValidators: true, timestamps: false },
    );
    return repair;
  }

  async saveRepairAndArtifact(userId, repair, artifact) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await RepairRecord.updateOne(
          { userId, recordId: repair.id },
          { $set: { data: repair, createdAt: new Date(repair.createdAt) }, $setOnInsert: { userId, recordId: repair.id } },
          { upsert: true, runValidators: true, timestamps: false, session },
        );
        await ArtifactRecord.updateOne(
          { userId, recordId: artifact.id },
          { $set: { data: artifact, createdAt: new Date(artifact.createdAt) }, $setOnInsert: { userId, recordId: artifact.id } },
          { upsert: true, runValidators: true, timestamps: false, session },
        );
      });
    } finally {
      await session.endSession();
    }
    return { repair, artifact };
  }

  async getRepair(userId, repairId) {
    return recordData(await RepairRecord.findOne({ userId, recordId: repairId }).lean());
  }

  async listRepairs(userId, auditId) {
    const records = await RepairRecord.find({ userId, "data.auditId": auditId }).sort({ createdAt: 1 }).lean();
    return records.map(recordData);
  }

  async saveVerification(userId, verification) {
    await VerificationRecord.updateOne(
      { userId, recordId: verification.id },
      { $set: { data: verification, createdAt: new Date(verification.createdAt) }, $setOnInsert: { userId, recordId: verification.id } },
      { upsert: true, runValidators: true, timestamps: false },
    );
    return verification;
  }

  async saveArtifact(userId, artifact) {
    await ArtifactRecord.updateOne(
      { userId, recordId: artifact.id },
      { $set: { data: artifact, createdAt: new Date(artifact.createdAt) }, $setOnInsert: { userId, recordId: artifact.id } },
      { upsert: true, runValidators: true, timestamps: false },
    );
    return artifact;
  }

  async listVerifications(userId, auditId) {
    const records = await VerificationRecord.find({
      userId,
      $or: [{ "data.baselineAuditId": auditId }, { "data.comparisonBaselineAuditId": auditId }],
    }).sort({ createdAt: 1 }).lean();
    return records.map(recordData);
  }

  async listVerificationsForRepairs(userId, repairIds) {
    if (!repairIds.length) return [];
    const records = await VerificationRecord.find({ userId, "data.repairId": { $in: repairIds } }).lean();
    return records.map(recordData);
  }
}
