import crypto from "node:crypto";
import db, { logAudit, runTransaction } from "../../db.js";
import { storageService, sanitizeFilename } from "./storage.js";
import { validateFileBuffer } from "./fileValidator.js";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg"
];

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit

/**
 * Checks if a user is an authorized party (landlord or tenant) or enterprise officer for an agreement
 */
export function isAuthorizedAgreementParty(user, agreement) {
  if (!user) return false;
  
  // Enterprise oversight roles
  const enterpriseRoles = ["Super Admin", "Admin", "Legal Officer", "Auditor"];
  if (enterpriseRoles.includes(user.role)) return true;

  // Check user email against agreement parties or landlord/tenant addresses
  if (user.email === agreement.landlord_address || user.email === agreement.tenant_address) {
    return true;
  }

  // Check user wallets if linked
  const userWallets = db.prepare("SELECT wallet_address FROM wallets WHERE user_id = ?").all(user.id || 0).map(w => w.wallet_address.toLowerCase());
  if (agreement.landlord_address && userWallets.includes(agreement.landlord_address.toLowerCase())) {
    return true;
  }
  if (agreement.tenant_address && userWallets.includes(agreement.tenant_address.toLowerCase())) {
    return true;
  }

  // Check property ownership if linked
  if (agreement.property_id) {
    const prop = db.prepare("SELECT landlord_id FROM properties WHERE id = ?").get(agreement.property_id);
    if (prop && prop.landlord_id === user.id) {
      return true;
    }
  }

  return false;
}

/**
 * Upload and persist a lease document with server-computed cryptographic SHA-256 verification
 */
export async function uploadDocument({ agreementId, file, user, isPrimaryLease = false, req = null }) {
  if (!agreementId || !file) {
    const err = new Error("Agreement ID and document file are required");
    err.status = 400;
    throw err;
  }

  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    const err = new Error(`Invalid document MIME type (${file.mimetype}). Allowed types: PDF, DOCX, TXT, PNG, JPEG.`);
    err.status = 400;
    throw err;
  }

  // Deep Magic-Byte Validation (MED-05)
  const validation = validateFileBuffer(file.buffer, file.mimetype);
  if (!validation.valid) {
    const err = new Error(`Document verification failed: ${validation.error}`);
    err.status = 400;
    throw err;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const err = new Error(`File size (${file.size} bytes) exceeds maximum allowed limit of 5MB.`);
    err.status = 400;
    throw err;
  }

  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ? OR contract_address = ?").get(agreementId, agreementId);
  if (!agreement) {
    const err = new Error(`Agreement ${agreementId} not found`);
    err.status = 404;
    throw err;
  }

  // BOLA / IDOR Verification: Only landlord or legal/admin can upload documents for this agreement
  const canUpload = user && (
    ["Super Admin", "Admin", "Legal Officer"].includes(user.role) ||
    (user.role === "Property Owner" && isAuthorizedAgreementParty(user, agreement))
  );

  if (!canUpload) {
    logAudit(
      "SECURITY_ALERT",
      `Unauthorized document upload attempt for agreement ${agreementId} by user ${user ? user.email : "anonymous"}`,
      user ? user.email : "anonymous",
      agreement.id,
      req
    );
    const err = new Error("Access denied: You are not authorized to upload documents for this agreement");
    err.status = 403;
    throw err;
  }

  // Compute SHA-256 hash server-side
  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const docId = `doc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const safeFilename = sanitizeFilename(file.originalname);
  const storageKey = `agreements/${agreement.id}/${Date.now()}_${safeFilename}`;

  // Store object via adapter
  await storageService.putObject(storageKey, file.buffer, file.mimetype);

  // Insert metadata record into documents table and sync agreement hash atomically (MED-01)
  runTransaction(() => {
    db.prepare(`
      INSERT INTO documents (
        id, agreement_id, storage_key, original_filename, sha256,
        mime_type, size_bytes, uploaded_by, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      docId,
      agreement.id,
      storageKey,
      safeFilename,
      sha256,
      file.mimetype,
      file.size,
      user.email
    );

    // If designated as primary lease contract or if agreement has no hash, sync agreement hash
    if (isPrimaryLease) {
      db.prepare(`
        UPDATE agreements 
        SET current_document_hash = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(sha256, agreement.id);
    }
  });

  logAudit(
    "DOCUMENT_UPLOADED",
    `Document ${safeFilename} (${file.size} bytes, SHA-256: ${sha256.substring(0, 16)}...) uploaded for agreement ${agreement.id}`,
    user.email,
    agreement.id,
    req
  );

  return {
    id: docId,
    agreementId: agreement.id,
    filename: safeFilename,
    sha256,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    uploadedBy: user.email,
    createdAt: new Date().toISOString()
  };
}

/**
 * Retrieves a document stream/buffer for an authorized user
 */
export async function getDocumentDownload({ documentId, user, req = null }) {
  if (!documentId) {
    const err = new Error("Document ID is required");
    err.status = 400;
    throw err;
  }

  const document = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
  if (!document) {
    const err = new Error(`Document ${documentId} not found`);
    err.status = 404;
    throw err;
  }

  // Check agreement authorization
  if (document.agreement_id) {
    const agreement = db.prepare("SELECT * FROM agreements WHERE id = ?").get(document.agreement_id);
    if (agreement && !isAuthorizedAgreementParty(user, agreement)) {
      logAudit(
        "SECURITY_ALERT",
        `Unauthorized document download attempt for ${documentId} by user ${user ? user.email : "anonymous"}`,
        user ? user.email : "anonymous",
        document.agreement_id,
        req
      );
      const err = new Error("Access denied: You do not have permission to view this document");
      err.status = 403;
      throw err;
    }
  }

  const fileData = await storageService.getObject(document.storage_key);

  logAudit(
    "DOCUMENT_DOWNLOADED",
    `Document ${document.original_filename} (${document.id}) downloaded by ${user.email}`,
    user.email,
    document.agreement_id,
    req
  );

  return {
    document,
    buffer: fileData.buffer
  };
}

/**
 * List all active documents linked to an agreement for authorized parties
 */
export function listAgreementDocuments({ agreementId, user, req = null }) {
  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ? OR contract_address = ?").get(agreementId, agreementId);
  if (!agreement) {
    const err = new Error(`Agreement ${agreementId} not found`);
    err.status = 404;
    throw err;
  }

  if (!isAuthorizedAgreementParty(user, agreement)) {
    logAudit(
      "SECURITY_ALERT",
      `Unauthorized document listing attempt for agreement ${agreementId} by user ${user ? user.email : "anonymous"}`,
      user ? user.email : "anonymous",
      agreement.id,
      req
    );
    const err = new Error("Access denied: You do not have permission to list documents for this agreement");
    err.status = 403;
    throw err;
  }

  const docs = db.prepare(`
    SELECT id, agreement_id, original_filename, sha256, mime_type, size_bytes, uploaded_by, status, created_at 
    FROM documents 
    WHERE agreement_id = ? AND status = 'ACTIVE' 
    ORDER BY created_at DESC
  `).all(agreement.id);

  return docs;
}
