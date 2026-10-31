import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Sanitizes a filename to prevent directory traversal and filesystem abuse
 */
export function sanitizeFilename(rawName) {
  if (!rawName || typeof rawName !== "string") {
    return "document.bin";
  }
  // Strip null bytes, paths, and dangerous special characters
  const base = path.basename(rawName).replace(/[\0\x00-\x1f\x7f\\/\?<>:\*\|":]/g, "_");
  // Limit length
  return base.slice(0, 120) || "document.bin";
}

/**
 * Ensures resolved target path does not escape the configured base storage directory
 */
export function resolveSafePath(baseDir, relativePath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, relativePath);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error("Path traversal attempt detected");
  }
  return resolvedPath;
}

/**
 * Local Disk Storage Adapter for zero-cost local development and testing
 */
export class LocalStorageAdapter {
  constructor(baseDir) {
    this.baseDir = baseDir || process.env.DOCUMENT_STORAGE_DIR || path.resolve(__dirname, "../../uploads");
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async putObject(storageKey, buffer, mimeType) {
    const safePath = resolveSafePath(this.baseDir, storageKey);
    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      await fsp.mkdir(parentDir, { recursive: true });
    }

    await fsp.writeFile(safePath, buffer);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    return {
      storageKey,
      size: buffer.length,
      sha256,
      mimeType,
      location: safePath
    };
  }

  async getObject(storageKey) {
    const safePath = resolveSafePath(this.baseDir, storageKey);
    if (!fs.existsSync(safePath)) {
      throw new Error(`Document file not found at key: ${storageKey}`);
    }

    const buffer = await fsp.readFile(safePath);
    const stat = await fsp.stat(safePath);

    return {
      buffer,
      size: stat.size
    };
  }

  async deleteObject(storageKey) {
    const safePath = resolveSafePath(this.baseDir, storageKey);
    if (fs.existsSync(safePath)) {
      await fsp.unlink(safePath);
      return true;
    }
    return false;
  }
}

/**
 * S3 Storage Adapter for Production Amazon S3 Deployments
 * Gracefully falls back to local storage if AWS SDK or bucket credentials are not provided
 */
export class S3StorageAdapter {
  constructor(options = {}) {
    this.bucket = options.bucket || process.env.AWS_S3_BUCKET;
    this.region = options.region || process.env.AWS_REGION || "us-east-1";
    this.fallbackAdapter = new LocalStorageAdapter(options.fallbackDir);
    this.isS3Configured = Boolean(this.bucket && process.env.AWS_ACCESS_KEY_ID);
  }

  async putObject(storageKey, buffer, mimeType) {
    if (!this.isS3Configured) {
      return this.fallbackAdapter.putObject(storageKey, buffer, mimeType);
    }

    try {
      // Dynamic import to maintain zero-cost local dev without mandatory AWS SDK installation
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: this.region });
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

      await client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
        Metadata: { sha256 }
      }));

      return {
        storageKey,
        size: buffer.length,
        sha256,
        mimeType,
        location: `s3://${this.bucket}/${storageKey}`
      };
    } catch (err) {
      console.warn(`[STORAGE] S3 putObject failed (${err.message}). Falling back to local storage.`);
      return this.fallbackAdapter.putObject(storageKey, buffer, mimeType);
    }
  }

  async getObject(storageKey) {
    if (!this.isS3Configured) {
      return this.fallbackAdapter.getObject(storageKey);
    }

    try {
      const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: this.region });
      const response = await client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: storageKey
      }));

      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      return {
        buffer,
        size: buffer.length
      };
    } catch (err) {
      console.warn(`[STORAGE] S3 getObject failed (${err.message}). Falling back to local storage.`);
      return this.fallbackAdapter.getObject(storageKey);
    }
  }

  async deleteObject(storageKey) {
    if (!this.isS3Configured) {
      return this.fallbackAdapter.deleteObject(storageKey);
    }

    try {
      const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: this.region });
      await client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storageKey
      }));
      return true;
    } catch (err) {
      return this.fallbackAdapter.deleteObject(storageKey);
    }
  }
}

// Export singleton storage service based on environment
export const storageService = process.env.NODE_ENV === "production" && process.env.AWS_S3_BUCKET
  ? new S3StorageAdapter()
  : new LocalStorageAdapter();
