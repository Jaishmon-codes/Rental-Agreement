import express from "express";
import multer from "multer";
import { uploadDocument, getDocumentDownload, listAgreementDocuments } from "../services/document/documentService.js";

const router = express.Router();

// 5MB in-memory upload limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

export default function createDocumentRouter({ authenticateToken, requirePermission }) {
  /**
   * POST /api/documents/upload
   * Uploads and cryptographically hashes lease document
   */
  router.post(
    "/upload",
    authenticateToken,
    requirePermission("DOCUMENT_UPLOAD"),
    upload.single("file"),
    async (req, res) => {
      try {
        const { agreementId, isPrimaryLease } = req.body;
        const result = await uploadDocument({
          agreementId,
          file: req.file,
          user: req.user,
          isPrimaryLease: isPrimaryLease === "true" || isPrimaryLease === true,
          req
        });
        res.status(201).json(result);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    }
  );

  /**
   * GET /api/documents/:id/download
   * Streams stored document to authorized agreement parties
   */
  router.get(
    "/:id/download",
    authenticateToken,
    requirePermission("DOCUMENT_VIEW"),
    async (req, res) => {
      try {
        const { document, buffer } = await getDocumentDownload({
          documentId: req.params.id,
          user: req.user,
          req
        });

        res.setHeader("Content-Type", document.mime_type || "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(document.original_filename)}"`
        );
        res.setHeader("Content-Length", document.size_bytes);
        res.setHeader("X-Document-SHA256", document.sha256);

        res.send(buffer);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    }
  );

  /**
   * GET /api/documents/agreement/:id
   * Lists all documents tied to an agreement
   */
  router.get(
    "/agreement/:id",
    authenticateToken,
    requirePermission("DOCUMENT_VIEW"),
    (req, res) => {
      try {
        const docs = listAgreementDocuments({
          agreementId: req.params.id,
          user: req.user,
          req
        });
        res.json(docs);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    }
  );

  return router;
}
