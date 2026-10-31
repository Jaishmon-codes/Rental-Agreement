import React from "react";
import { Shield, Wallet, AlertTriangle, User, LogOut, KeyRound } from "lucide-react";
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
  loading,
  currentUser,
  onOpenAuth,
  onLogout,
  onOpenWalletModal
}) {
  const isPrivileged = currentUser && ["Super Admin", "Finance Admin", "Auditor", "Legal Officer", "Support Admin"].includes(currentUser.role);
  const isLandlord = currentUser && (currentUser.role === "Property Owner" || currentUser.role === "Super Admin");
  const isTenant = currentUser && (currentUser.role === "Tenant" || currentUser.role === "Super Admin");

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
        <div className="brand" style={{ cursor: "pointer" }} onClick={() => setActiveTab("properties")}>
          <Shield size={28} style={{ color: "var(--accent-cyan)" }} />
          <span>RentSphere</span>
        </div>

        {/* Tab Navigation */}
        <div className="tab-bar" style={{ overflowX: "auto", maxWidth: "600px" }}>
          <button
            className={`tab-btn ${activeTab === "properties" ? "active" : ""}`}
            onClick={() => setActiveTab("properties")}
          >
            Properties
          </button>

          {(!currentUser || isLandlord) && (
            <button
              className={`tab-btn ${activeTab === "landlord" ? "active" : ""}`}
              onClick={() => setActiveTab("landlord")}
            >
              Landlord
            </button>
          )}

          {(!currentUser || isTenant) && (
            <button
              className={`tab-btn ${activeTab === "tenant" ? "active" : ""}`}
              onClick={() => setActiveTab("tenant")}
            >
              Tenant
            </button>
          )}

          <button
            className={`tab-btn ${activeTab === "documents" ? "active" : ""}`}
            onClick={() => setActiveTab("documents")}
          >
            Documents
          </button>

          <button
            className={`tab-btn ${activeTab === "explore" ? "active" : ""}`}
            onClick={() => setActiveTab("explore")}
          >
            Explorer
          </button>

          {(!currentUser || isPrivileged) && (
            <button
              className={`tab-btn ${activeTab === "enterprise" ? "active" : ""}`}
              onClick={() => setActiveTab("enterprise")}
            >
              Enterprise FinOps
            </button>
          )}
        </div>

        {/* Auth & Wallet Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Web3 Wallet Pill */}
          {account ? (
            <div
              onClick={onOpenWalletModal}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border-color)",
                padding: "0.4rem 0.8rem",
                borderRadius: "10px",
                cursor: "pointer"
              }}
              title="Click to manage linked EVM wallets"
            >
              <div style={{
                width: "8px",
                height: "8px",
                background: isCorrectNetwork ? "var(--accent-emerald)" : "var(--accent-rose)",
                borderRadius: "50%"
              }}></div>
              <span style={{ fontSize: "0.8rem", fontFamily: "monospace", fontWeight: 500 }}>
                {formatShortAddress(account)}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--accent-cyan)", borderLeft: "1px solid var(--border-color)", paddingLeft: "0.5rem" }}>
                {balance} ETH
              </span>
            </div>
          ) : (
            <button
              className="btn-outline"
              onClick={onOpenWalletModal || onConnect}
              disabled={loading}
              style={{ fontSize: "0.8rem", padding: "0.45rem 0.8rem", gap: "0.4rem" }}
            >
              <Wallet size={15} />
              <span>Link Wallet</span>
            </button>
          )}

          {/* User Auth Pill */}
          {currentUser ? (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "rgba(155, 81, 224, 0.08)",
              border: "1px solid rgba(155, 81, 224, 0.3)",
              padding: "0.35rem 0.75rem",
              borderRadius: "10px"
            }}>
              <User size={15} style={{ color: "var(--accent-purple)" }} />
              <div>
                <div style={{ fontSize: "0.8rem", fontWeight: 600, lineHeight: 1.2 }}>
                  {currentUser.name?.split(" ")[0] || currentUser.email}
                </div>
                <div style={{ fontSize: "0.65rem", color: "var(--accent-cyan)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {currentUser.role}
                </div>
              </div>
              <button
                onClick={onLogout}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  padding: "2px",
                  marginLeft: "4px"
                }}
                title="Log out"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              className="btn-primary"
              onClick={onOpenAuth}
              style={{ fontSize: "0.8rem", padding: "0.45rem 0.9rem", gap: "0.4rem" }}
            >
              <KeyRound size={15} />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>
    </>
  );
}
