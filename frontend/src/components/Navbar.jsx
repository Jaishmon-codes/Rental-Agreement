import React from "react";
import { Shield, Wallet, AlertTriangle } from "lucide-react";
import { formatShortAddress } from "../utils/crypto.js";

export default function Navbar({
  account,
  balance,
  networkName,
  isCorrectNetwork,
  activeTab,
  setActiveTab,
  onConnect,
  onSwitchNetwork,
  loading
}) {
  return (
    <>
      {/* Network Alert Banner */}
      {!isCorrectNetwork && account && (
        <div style={{
          background: "rgba(244, 63, 94, 0.15)",
          border: "1px solid var(--accent-rose)",
          borderRadius: "12px",
          padding: "0.85rem 1.25rem",
          marginBottom: "1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "var(--accent-rose)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <AlertTriangle size={22} />
            <div>
              <div style={{ fontWeight: 600, fontFamily: "Space Grotesk" }}>
                Unsupported Network ({networkName})
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Please switch your wallet provider to Hardhat Localhost (Chain ID: 1337) or Sepolia.
              </div>
            </div>
          </div>
          <button
            className="btn-primary"
            onClick={onSwitchNetwork}
            style={{ fontSize: "0.85rem", padding: "0.4rem 0.9rem", border: "none" }}
          >
            Switch to Localhost
          </button>
        </div>
      )}

      {/* Main Header */}
      <header className="app-header glass-panel">
        <div className="brand" style={{ cursor: "pointer" }} onClick={() => setActiveTab("landlord")}>
          <Shield size={28} style={{ color: "var(--accent-cyan)" }} />
          <span>RentSphere</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {account && (
            <div className="tab-bar">
              <button
                className={`tab-btn ${activeTab === "landlord" ? "active" : ""}`}
                onClick={() => setActiveTab("landlord")}
              >
                Landlord Panel
              </button>
              <button
                className={`tab-btn ${activeTab === "tenant" ? "active" : ""}`}
                onClick={() => setActiveTab("tenant")}
              >
                Tenant Panel
              </button>
              <button
                className={`tab-btn ${activeTab === "explore" ? "active" : ""}`}
                onClick={() => setActiveTab("explore")}
              >
                Explore & Verify
              </button>
              <button
                className={`tab-btn ${activeTab === "enterprise" ? "active" : ""}`}
                onClick={() => setActiveTab("enterprise")}
              >
                Enterprise SaaS
              </button>
            </div>
          )}

          {account ? (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--border-color)",
              padding: "0.5rem 1rem",
              borderRadius: "12px"
            }}>
              <div style={{
                width: "8px",
                height: "8px",
                background: isCorrectNetwork ? "var(--accent-emerald)" : "var(--accent-rose)",
                borderRadius: "50%"
              }}></div>
              <span style={{ fontSize: "0.85rem", fontWeight: 500, fontFamily: "monospace" }}>
                {formatShortAddress(account)}
              </span>
              <span style={{
                fontSize: "0.85rem",
                color: "var(--accent-cyan)",
                borderLeft: "1px solid var(--border-color)",
                paddingLeft: "0.75rem"
              }}>
                {balance} ETH
              </span>
            </div>
          ) : (
            <button className="btn-primary" onClick={onConnect} disabled={loading}>
              <Wallet size={18} />
              {loading ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>
    </>
  );
}
