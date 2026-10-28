import mongoose from "mongoose";
import { ArtifactRecord, AuditRecord, RepairRecord, User, VerificationRecord } from "./models.js";

let connectionPromise = null;
let databaseReady = false;

export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri?.trim()) {
    return { connected: false, status: "not_configured", message: "MONGODB_URI is not configured." };
  }
  if (mongoose.connection.readyState === 1 && databaseReady) {
    return { connected: true, status: "connected" };
  }

  connectionPromise ??= mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    autoIndex: false,
  }).then(async () => {
    await Promise.all([
      User.createIndexes(),
      AuditRecord.createIndexes(),
      RepairRecord.createIndexes(),
      VerificationRecord.createIndexes(),
      ArtifactRecord.createIndexes(),
    ]);
    databaseReady = true;
    return { connected: true, status: "connected" };
  })
    .catch((error) => {
      connectionPromise = null;
      databaseReady = false;
      console.error("MongoDB connection failed:", { name: error.name, code: error.code });
      return { connected: false, status: "unavailable", message: "MongoDB could not be reached." };
    });

  return connectionPromise;
}

export function getDatabaseStatus() {
  if (!process.env.MONGODB_URI?.trim()) return { connected: false, status: "not_configured" };
  if (mongoose.connection.readyState === 1 && databaseReady) return { connected: true, status: "connected" };
  return { connected: false, status: "unavailable" };
}

export async function disconnectDatabase() {
  connectionPromise = null;
  databaseReady = false;
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
