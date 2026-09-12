import React, { useState } from "react";
import { ethers } from "ethers";
import { Search, Shield, FileText, CheckCircle, AlertTriangle, FileUp } from "lucide-react";
import { computeFileSHA256, formatShortAddress } from "../utils/crypto.js";

export default function ExplorePanel({
  onExplore,
  exploreDetails,
  exploreError,
  loading
}) {
  const [addressInput, setAddressInput] = useState("");
  const [uploadedHash, setUploadedHash] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [isHashing, setIsHashing] = useState(false);

  const handleSearch = (e) => {
    e.preventDefault();
    if (addressInput.trim()) {
      onExplore(addressInput.trim());
    }
  };

  const handleVerifyFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsHashing(true);
      setUploadedFileName(file.name);
      const hash = await computeFileSHA256(file);
      setUploadedHash(hash);
      setIsHashing(false);
    } catch (err) {
      console.error("Hashing failed:", err);
      setIsHashing(false);
    }
  };

  const isHashMatch = exploreDetails && uploadedHash && (
    exploreDetails.documentHash.toLowerCase().trim() === uploadedHash.toLowerCase().trim()
  );

  return (
    <div style={{ maxWidth: "780px", margin: "0 auto" }}>
      <div className="glass-panel" style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ margin: "0 0 0.5rem 0" }}>Explore & Verify On-Chain Leases</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: 0 }}>
            Inspect contract terms, verify lease legitimacy, review vault balances, and authenticate physical lease documents using cryptographic SHA-256 verification.
          </p>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                className="form-input"
                style={{ fontSize: "1rem" }}
                type="text"
                placeholder="Paste Lease Contract Address (0x...)"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
              />
              <button className="btn-primary" type="submit" style={{ padding: "0.75rem 1.5rem" }} disabled={loading}>
                <Search size={18} />
              </button>
            </div>
          </div>
        </form>

        {exploreError && (
          <div style={{ color: "var(--accent-rose)", textAlign: "center", fontSize: "0.9rem" }}>
            {exploreError}
          </div>
        )}

        {/* Contract Details View */}
        {exploreDetails && (
          <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.25rem" }}>{exploreDetails.propertyAddress}</h3>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                  {exploreDetails.address}
                </span>
              </div>
              <span className={`status-badge ${exploreDetails.active ? "status-active" : (exploreDetails.tenant === ethers.ZeroAddress ? "status-pending" : "status-closed")}`}>
                {exploreDetails.active ? "Active" : (exploreDetails.tenant === ethers.ZeroAddress ? "Awaiting Tenant" : "Closed")}
              </span>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "1rem",
              background: "rgba(0,0,0,0.2)",
              padding: "1rem",
              borderRadius: "10px",
              fontSize: "0.9rem"
            }}>
              <div className="info-item">
                <span className="info-label">Rent Amount</span>
                <span className="info-val">{ethers.formatEther(exploreDetails.rentAmount)} ETH</span>
              </div>
              <div className="info-item">
                <span className="info-label">Security Deposit</span>
                <span className="info-val">{ethers.formatEther(exploreDetails.securityDeposit)} ETH</span>
              </div>
              <div className="info-item">
                <span className="info-label">Landlord</span>
                <span className="info-val address-val">{formatShortAddress(exploreDetails.landlord, 6)}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Tenant</span>
                <span className="info-val address-val">
                  {exploreDetails.tenant !== ethers.ZeroAddress ? formatShortAddress(exploreDetails.tenant, 6) : "None registered"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Lease Duration</span>
                <span className="info-val">{Math.round(exploreDetails.duration / (24 * 60 * 60))} Days</span>
              </div>
              <div className="info-item">
                <span className="info-label">Vault Balance</span>
                <span className="info-val" style={{ color: "var(--accent-cyan)" }}>
                  {ethers.formatEther(exploreDetails.balance)} ETH
                </span>
              </div>
            </div>

            {/* Registered Document Hash */}
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--border-color)",
              padding: "1rem",
              borderRadius: "8px",
              fontSize: "0.85rem"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <FileText size={16} style={{ color: "var(--accent-cyan)" }} />
                <span style={{ fontWeight: 600 }}>Registered On-Chain Document Hash:</span>
              </div>
              <div style={{
                fontFamily: "monospace",
                wordBreak: "break-all",
                background: "rgba(0,0,0,0.3)",
                padding: "0.6rem",
                borderRadius: "4px",
                color: "var(--accent-cyan)"
              }}>
                {exploreDetails.documentHash}
              </div>
            </div>

            {/* Live Document Authenticity Verifier */}
            <div style={{
              border: "1px solid rgba(0, 242, 254, 0.2)",
              borderRadius: "10px",
              padding: "1.25rem",
              background: "rgba(0, 242, 254, 0.03)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <Shield size={18} style={{ color: "var(--accent-cyan)" }} />
                <h4 style={{ margin: 0 }}>Document Authenticity Verifier</h4>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 1rem 0" }}>
                Upload the physical PDF file received off-chain to confirm it has not been modified or tampered with since on-chain registration.
              </p>

              <div style={{
                border: "1px dashed var(--border-glow)",
                borderRadius: "8px",
                padding: "1rem",
                textAlign: "center",
                background: "rgba(0,0,0,0.2)",
                marginBottom: "1rem"
              }}>
                <input
                  type="file"
                  id="verify-file-input"
                  accept=".pdf,.docx,.txt"
                  onChange={handleVerifyFileUpload}
                  style={{ display: "none" }}
                />
                <label
                  htmlFor="verify-file-input"
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                    color: "var(--accent-cyan)",
                    fontSize: "0.9rem",
                    fontWeight: 500
                  }}
                >
                  <FileUp size={18} />
                  {isHashing ? "Computing Document SHA-256..." : (uploadedFileName ? `Inspecting: ${uploadedFileName}` : "Upload Document to Verify Authenticity")}
                </label>
              </div>

              {uploadedHash && (
                <div style={{
                  background: isHashMatch ? "rgba(16,185,129,0.1)" : "rgba(244,63,94,0.1)",
                  border: `1px solid ${isHashMatch ? "var(--accent-emerald)" : "var(--accent-rose)"}`,
                  borderRadius: "8px",
                  padding: "1rem",
                  fontSize: "0.85rem"
                }}>
                  <div style={{
                    fontWeight: 700,
                    fontSize: "1rem",
                    color: isHashMatch ? "var(--accent-emerald)" : "var(--accent-rose)",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "0.5rem"
                  }}>
                    {isHashMatch ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                    {isHashMatch ? "DOCUMENT AUTHENTIC — CRYPTOGRAPHIC MATCH CONFIRMED" : "TAMPER WARNING — HASH MISMATCH"}
                  </div>
                  <div style={{ wordBreak: "break-all", marginBottom: "0.25rem", color: "var(--text-secondary)" }}>
                    <strong>Computed Hash:</strong> {uploadedHash}
                  </div>
                  <div style={{ wordBreak: "break-all", color: "var(--text-secondary)" }}>
                    <strong>On-Chain Hash:</strong> {exploreDetails.documentHash}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
