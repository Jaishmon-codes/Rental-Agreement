import React, { useState, useEffect } from "react";
import { FileText, Upload, Download, ShieldCheck, CheckCircle2, AlertCircle, RefreshCw, FileCheck } from "lucide-react";
import api from "../services/api.js";

export default function DocumentsPanel({ _currentUser, agreements = [] }) {
  const [selectedAgreementId, setSelectedAgreementId] = useState(agreements[0]?.id || "agreement_001");
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [isPrimaryLease, setIsPrimaryLease] = useState(false);

  // Verification state
  const [verifyFile, setVerifyFile] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const fetchDocuments = async (agreementId) => {
    if (!agreementId) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const list = await api.getAgreementDocuments(agreementId);
      setDocuments(list || []);
    } catch (err) {
      console.error("Failed to load documents:", err);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAgreementId) {
      fetchDocuments(selectedAgreementId);
    }
  }, [selectedAgreementId]);

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile || !selectedAgreementId) return;

    setUploading(true);
    setErrorMsg("");
    setSuccessMsg("");

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("agreementId", selectedAgreementId);
    if (isPrimaryLease) {
      formData.append("isPrimaryLease", "true");
    }

    try {
      const res = await api.uploadDocument(formData);
      setSuccessMsg(`Document "${res.filename}" uploaded & verified! SHA-256: ${res.sha256.substring(0, 16)}...`);
      setSelectedFile(null);
      await fetchDocuments(selectedAgreementId);
    } catch (err) {
      setErrorMsg(err.message || "Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc) => {
    try {
      const blob = await api.downloadDocument(doc.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.original_filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    }
  };

  const handleVerifyFile = async (e) => {
    e.preventDefault();
    if (!verifyFile || !selectedAgreementId) return;

    setVerifying(true);
    setVerifyResult(null);

    try {
      // Use server-side verification endpoint
      const formData = new FormData();
      formData.append("file", verifyFile);
      formData.append("agreementId", selectedAgreementId);

      const res = await fetch("http://localhost:4000/api/verifyDocumentFile", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      setVerifyResult(data);
    } catch (err) {
      alert(`Verification error: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="panel-container" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: "0 0 0.25rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <FileText size={24} style={{ color: "var(--accent-cyan)" }} />
            Cryptographic Document Vault
          </h2>
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Server-side SHA-256 hash anchoring and authenticated document retrieval
          </p>
        </div>

        <button className="btn-outline" onClick={() => fetchDocuments(selectedAgreementId)} disabled={loading} style={{ fontSize: "0.85rem", padding: "0.5rem 0.85rem" }}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      {errorMsg && (
        <div style={{ background: "rgba(244,63,94,0.15)", border: "1px solid var(--accent-rose)", color: "var(--accent-rose)", padding: "0.75rem", borderRadius: "8px", fontSize: "0.85rem" }}>
          <AlertCircle size={16} style={{ display: "inline", marginRight: "6px" }} />
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div style={{ background: "rgba(16,185,129,0.15)", border: "1px solid var(--accent-emerald)", color: "var(--accent-emerald)", padding: "0.75rem", borderRadius: "8px", fontSize: "0.85rem" }}>
          <CheckCircle2 size={16} style={{ display: "inline", marginRight: "6px" }} />
          {successMsg}
        </div>
      )}

      {/* Select Agreement */}
      <div className="glass-panel" style={{ padding: "1rem 1.25rem", borderRadius: "10px", display: "flex", alignItems: "center", gap: "1rem" }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Active Lease Agreement:</span>
        <select
          className="input-field"
          value={selectedAgreementId}
          onChange={(e) => setSelectedAgreementId(e.target.value)}
          style={{ maxWidth: "320px" }}
        >
          {agreements.map((a) => (
            <option key={a.id || a.address} value={a.id || a.address}>
              {a.id || a.address} ({a.property_details || a.propertyDetails || "Standard Lease"})
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.5rem" }}>
        {/* Left: Document List */}
        <div className="glass-panel" style={{ padding: "1.25rem", borderRadius: "12px" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <FileCheck size={18} style={{ color: "var(--accent-emerald)" }} />
            Stored Contract Documents ({documents.length})
          </h3>

          {documents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              No documents stored for this agreement yet. Upload the official PDF or TXT contract below.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {documents.map((doc) => (
                <div key={doc.id} style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  padding: "0.85rem 1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{doc.original_filename}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                      {(doc.size_bytes / 1024).toFixed(1)} KB • Uploaded by {doc.uploaded_by}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--accent-cyan)", marginTop: "4px" }}>
                      SHA: {doc.sha256}
                    </div>
                  </div>

                  <button
                    className="btn-outline"
                    onClick={() => handleDownload(doc)}
                    style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem", display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    <Download size={14} /> Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Upload & Verify Section */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Upload Box */}
          <div className="glass-panel" style={{ padding: "1.25rem", borderRadius: "12px" }}>
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Upload size={18} style={{ color: "var(--accent-purple)" }} />
              Upload Lease Document
            </h3>

            <form onSubmit={handleFileUpload} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <input
                type="file"
                className="input-field"
                accept=".pdf,.docx,.txt,image/*"
                onChange={(e) => setSelectedFile(e.target.files[0])}
                required
              />

              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8rem", color: "var(--text-secondary)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isPrimaryLease}
                  onChange={(e) => setIsPrimaryLease(e.target.checked)}
                />
                Designate as Primary On-Chain Lease Document
              </label>

              <button
                type="submit"
                className="btn-primary"
                disabled={uploading || !selectedFile}
                style={{ justifyContent: "center", marginTop: "0.5rem" }}
              >
                {uploading ? "Hashing & Storing..." : "Upload & Anchor SHA-256"}
              </button>
            </form>
          </div>

          {/* Instant Integrity Check */}
          <div className="glass-panel" style={{ padding: "1.25rem", borderRadius: "12px" }}>
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <ShieldCheck size={18} style={{ color: "var(--accent-cyan)" }} />
              Instant File Integrity Check
            </h3>

            <form onSubmit={handleVerifyFile} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <input
                type="file"
                className="input-field"
                accept=".pdf,.docx,.txt"
                onChange={(e) => setVerifyFile(e.target.files[0])}
                required
              />

              <button
                type="submit"
                className="btn-outline"
                disabled={verifying || !verifyFile}
                style={{ justifyContent: "center" }}
              >
                {verifying ? "Computing Hash..." : "Verify Against Stored Hash"}
              </button>
            </form>

            {verifyResult && (
              <div style={{
                marginTop: "1rem",
                padding: "0.75rem",
                borderRadius: "8px",
                background: verifyResult.isValid ? "rgba(16,185,129,0.15)" : "rgba(244,63,94,0.15)",
                border: verifyResult.isValid ? "1px solid var(--accent-emerald)" : "1px solid var(--accent-rose)",
                fontSize: "0.8rem"
              }}>
                <div style={{ fontWeight: 600, color: verifyResult.isValid ? "var(--accent-emerald)" : "var(--accent-rose)", marginBottom: "4px" }}>
                  {verifyResult.isValid ? "✓ Integrity Verified: Document Matches Official Record" : "✗ Integrity Warning: SHA-256 Hash Mismatch"}
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                  Server Hash: {verifyResult.serverComputedHash?.substring(0, 24)}...
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
