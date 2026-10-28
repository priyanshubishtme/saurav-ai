import mongoose from "mongoose";

const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, required: true, select: false },
}, { timestamps: true, versionKey: false });

const ownedRecordSchema = new Schema({
  recordId: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  data: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, required: true, index: true },
}, { timestamps: true, versionKey: false });
ownedRecordSchema.index({ userId: 1, recordId: 1 }, { unique: true });

export const User = mongoose.models.User ?? mongoose.model("User", userSchema);
export const AuditRecord = mongoose.models.AuditRecord ?? mongoose.model("AuditRecord", ownedRecordSchema, "audits");
export const RepairRecord = mongoose.models.RepairRecord ?? mongoose.model("RepairRecord", ownedRecordSchema, "repairs");
export const VerificationRecord = mongoose.models.VerificationRecord ?? mongoose.model("VerificationRecord", ownedRecordSchema, "verifications");
export const ArtifactRecord = mongoose.models.ArtifactRecord ?? mongoose.model("ArtifactRecord", ownedRecordSchema, "artifacts");
