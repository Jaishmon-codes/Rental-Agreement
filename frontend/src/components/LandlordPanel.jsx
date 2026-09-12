import React, { useState } from "react";
import { ethers } from "ethers";
import { Plus, RefreshCw, Building, FileUp, Copy } from "lucide-react";
import { computeFileSHA256, formatShortAddress } from "../utils/crypto.js";

export default function LandlordPanel({
  agreements,
  onCreateLease,
  onClaimRent,
  onEndLease,
  onRefresh,
  loading,
  isCorrectNetwork
}) {
  const [propAddr, setPropAddr] = useState("");
  const [rentEth, setRentEth] = useState("0.05");
  const [depositEth, setDepositEth] = useState("0.1");
  const [durationDays, setDurationDays] = useState("30");
  const [docHash, setDocHash] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [isHashing, setIsHashing] = useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsHashing(true);
      setSelectedFileName(file.name);
      const hash = await computeFileSHA256(file);
      setDocHash(hash);
      setIsHashing(false);
    } catch (err) {
      console.error("Hashing failed:", err);
      setIsHashing(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!docHash) {
      alert("Please upload an agreement document to compute its cryptographic hash or enter an IPFS hash.");
      return;
    }

    await onCreateLease({
      propertyAddress: propAddr,
      rentEth,
      depositEth,
      durationDays,
      documentHash: docHash
    });

    // Reset form upon submission
    setPropAddr("");
    setDocHash("");
    setSelectedFileName("");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem", alignItems: "start" }}>
      {/* Deploy Form */}
      <div className="glass-panel" style={{ padding: "1.5rem" }}>
        <h3 style={{ marginTop: 0, marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Plus size={20} style={{ color: "var(--accent-cyan)" }} />
          Deploy New Smart Lease
        </h3>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Property Address / Unit</label>
            <input
              className="form-input"
              required
              type="text"
              placeholder="e.g. 742 Evergreen Terrace, Springfield"
              value={propAddr}
              onChange={(e) => setPropAddr(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Monthly Rent (ETH)</label>
            <input
              className="form-input"
              required
              type="number"
              step="0.001"
              min="0.001"
              placeholder="0.05"
              value={rentEth}
              onChange={(e) => setRentEth(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Security Deposit (ETH)</label>
            <input
              className="form-input"
              required
              type="number"
              step="0.001"
              min="0.001"
              placeholder="0.10"
              value={depositEth}
              onChange={(e) => setDepositEth(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Lease Duration (Days)</label>
            <input
              className="form-input"
              required
              type="number"
              min="1"
              placeholder="30"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
          </div>

          {/* Real Document Upload & Hash Calculation */}
          <div className="form-group">
            <label className="form-label">Lease Document (PDF/DOCX) or IPFS CID</label>
            <div style={{
              border: "1px dashed var(--border-glow)",
              borderRadius: "8px",
              padding: "0.75rem",
              background: "rgba(0,0,0,0.2)",
              textAlign: "center",
              marginBottom: "0.5rem"
            }}>
              <input
                type="file"
                id="lease-file-input"
                accept=".pdf,.docx,.txt"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
              <label
                htmlFor="lease-file-input"
                style={{
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  color: "var(--accent-cyan)",
                  fontSize: "0.85rem",
                  fontWeight: 500
                }}
              >
                <FileUp size={16} />
                {isHashing ? "Computing SHA-256..." : (selectedFileName ? `Selected: ${selectedFileName}` : "Upload Lease Document for SHA-256")}
              </label>
            </div>

            <input
              className="form-input"
              required
              type="text"
              placeholder="SHA-256 Hash or IPFS CID (Auto-populated on upload)"
              value={docHash}
              onChange={(e) => setDocHash(e.target.value)}
              style={{ fontSize: "0.8rem", fontFamily: "monospace" }}
            />
          </div>

          <button
            className="btn-primary"
            type="submit"
            style={{ width: "100%", justifyContent: "center", marginTop: "1rem" }}
            disabled={!isCorrectNetwork || loading}
          >
            Deploy Lease Contract
          </button>
        </form>
      </div>

      {/* Deployed Leases List */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0 }}>My Listed Properties</h3>
          <button
            className="btn-outline"
            style={{ padding: "0.4rem 0.75rem", fontSize: "0.85rem" }}
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Refresh
          </button>
        </div>

        {agreements.length === 0 ? (
          <div className="glass-panel" style={{ padding: "4rem 2rem", textAlign: "center", color: "var(--text-secondary)" }}>
            <Building size={48} style={{ opacity: 0.3, marginBottom: "1rem" }} />
            <p>No active rental agreements found. Use the deploy form on the left to list your first smart lease!</p>
          </div>
        ) : (
          <div className="dashboard-grid">
            {agreements.map((agreement) => {
              const hasTenant = agreement.tenant !== ethers.ZeroAddress;
              const claimableEth = agreement.claimableRent ? ethers.formatEther(agreement.claimableRent) : "0.0";
              const hasClaimable = Number(claimableEth) > 0;

              return (
                <div key={agreement.address} className="glass-panel agreement-card">
                  <div className="card-header">
                    <div>
                      <h4 className="card-title">{agreement.propertyAddress || "Unnamed Property"}</h4>
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                        {formatShortAddress(agreement.address, 6)}
                      </span>
                    </div>
                    <span className={`status-badge ${agreement.active ? "status-active" : (hasTenant ? "status-closed" : "status-pending")}`}>
                      {agreement.active && <span className="pulse-dot"></span>}
                      {agreement.active ? "Active" : (hasTenant ? "Terminated" : "Awaiting Tenant")}
                    </span>
                  </div>

                  <div className="card-body">
                    <div className="info-item">
                      <span className="info-label">Monthly Rent</span>
                      <span className="info-val">{ethers.formatEther(agreement.rentAmount)} ETH</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Security Deposit</span>
                      <span className="info-val">{ethers.formatEther(agreement.securityDeposit)} ETH</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Tenant</span>
                      <span className="info-val address-val">
                        {hasTenant ? formatShortAddress(agreement.tenant, 4) : "None yet"}
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Vault Balance</span>
                      <span className="info-val" style={{ color: "var(--accent-cyan)" }}>
                        {ethers.formatEther(agreement.balance)} ETH
                      </span>
                    </div>
                  </div>

                  {hasClaimable && (
                    <div style={{
                      background: "rgba(16, 185, 129, 0.1)",
                      border: "1px solid var(--accent-emerald)",
                      borderRadius: "8px",
                      padding: "0.5rem 0.75rem",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "0.85rem"
                    }}>
                      <span style={{ color: "var(--accent-emerald)", fontWeight: 600 }}>Rent Available to Claim:</span>
                      <span style={{ fontWeight: 700, color: "var(--accent-emerald)" }}>{claimableEth} ETH</span>
                    </div>
                  )}

                  <div className="card-actions">
                    {agreement.active ? (
                      <>
                        <button
                          className="btn-primary"
                          style={{ flex: 1, fontSize: "0.85rem", justifyContent: "center" }}
                          onClick={() => onClaimRent(agreement.address)}
                          disabled={!hasClaimable || loading}
                        >
                          Claim Rent
                        </button>
                        <button
                          className="btn-outline"
                          style={{ flex: 1, fontSize: "0.85rem", justifyContent: "center", borderColor: "rgba(244, 63, 94, 0.3)", color: "var(--accent-rose)" }}
                          onClick={() => onEndLease(agreement.address, true)}
                          disabled={loading}
                        >
                          End Lease
                        </button>
                      </>
                    ) : hasTenant ? (
                      <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", width: "100%" }}>
                        Lease Closed
                      </span>
                    ) : (
                      <button
                        className="btn-outline"
                        style={{ width: "100%", fontSize: "0.85rem", justifyContent: "center" }}
                        onClick={() => {
                          navigator.clipboard.writeText(agreement.address);
                          alert("Contract address copied to clipboard!");
                        }}
                      >
                        <Copy size={14} /> Copy Address to Share
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
