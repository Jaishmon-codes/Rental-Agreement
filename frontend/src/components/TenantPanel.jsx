import React, { useState } from "react";
import { ethers } from "ethers";
import { Search, User, RefreshCw, CheckCircle } from "lucide-react";
import { formatShortAddress } from "../utils/crypto.js";

export default function TenantPanel({
  agreements,
  account,
  onJoinLease,
  onPayRent,
  onTriggerExpiry,
  onRefresh,
  onExploreContract,
  exploreDetails,
  exploreError,
  loading
}) {
  const [searchAddr, setSearchAddr] = useState("");

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchAddr.trim()) {
      onExploreContract(searchAddr.trim());
    }
  };

  const getProgressPercentage = (startTime, duration) => {
    if (!startTime || !duration) return 0;
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - startTime;
    if (elapsed >= duration) return 100;
    return Math.max(0, Math.min(100, Math.floor((elapsed / duration) * 100)));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem", alignItems: "start" }}>
      {/* Lookup & Sign Lease Widget */}
      <div className="glass-panel" style={{ padding: "1.5rem" }}>
        <h3 style={{ marginTop: 0, marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <User size={20} style={{ color: "var(--accent-purple)" }} />
          Inspect & Sign Smart Lease
        </h3>

        <form onSubmit={handleSearch}>
          <div className="form-group">
            <label className="form-label">Rental Agreement Contract Address</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                className="form-input"
                type="text"
                placeholder="0x..."
                value={searchAddr}
                onChange={(e) => setSearchAddr(e.target.value)}
              />
              <button className="btn-outline" type="submit" style={{ padding: "0.5rem 1rem" }} disabled={loading}>
                <Search size={16} />
              </button>
            </div>
          </div>
        </form>

        {exploreError && (
          <div style={{ color: "var(--accent-rose)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
            {exploreError}
          </div>
        )}

        {exploreDetails && (
          <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border-color)", paddingTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>{exploreDetails.propertyAddress}</span>
              <span className={`status-badge ${exploreDetails.active ? "status-active" : (exploreDetails.tenant === ethers.ZeroAddress ? "status-pending" : "status-closed")}`}>
                {exploreDetails.active ? "Active" : (exploreDetails.tenant === ethers.ZeroAddress ? "Awaiting Tenant" : "Closed")}
              </span>
            </div>

            <div style={{ background: "rgba(0,0,0,0.2)", padding: "0.85rem", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Monthly Rent:</span>
                <span>{ethers.formatEther(exploreDetails.rentAmount)} ETH</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Security Deposit:</span>
                <span>{ethers.formatEther(exploreDetails.securityDeposit)} ETH</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border-color)", paddingTop: "0.5rem" }}>
                <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Total Due to Join:</span>
                <span style={{ color: "var(--accent-cyan)", fontWeight: 700 }}>
                  {ethers.formatEther(exploreDetails.rentAmount + exploreDetails.securityDeposit)} ETH
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Landlord:</span>
                <span style={{ fontFamily: "monospace" }}>{formatShortAddress(exploreDetails.landlord, 6)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Document Hash:</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                  {formatShortAddress(exploreDetails.documentHash, 8)}
                </span>
              </div>
            </div>

            {exploreDetails.tenant === ethers.ZeroAddress ? (
              <button
                className="btn-primary"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => onJoinLease(exploreDetails.address, exploreDetails.rentAmount, exploreDetails.securityDeposit)}
                disabled={loading}
              >
                Sign Lease & Deposit Funds ({ethers.formatEther(exploreDetails.rentAmount + exploreDetails.securityDeposit)} ETH)
              </button>
            ) : exploreDetails.tenant.toLowerCase() === account?.toLowerCase() ? (
              <div style={{ color: "var(--accent-emerald)", fontSize: "0.85rem", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                <CheckCircle size={16} /> You are the registered tenant for this lease.
              </div>
            ) : (
              <div style={{ color: "var(--accent-rose)", fontSize: "0.85rem", textAlign: "center" }}>
                Lease already rented by {formatShortAddress(exploreDetails.tenant, 6)}.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rented Leases List */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0 }}>My Active Leases</h3>
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
            <User size={48} style={{ opacity: 0.3, marginBottom: "1rem" }} />
            <p>You have not signed any active leases. Enter a lease contract address on the left to sign one!</p>
          </div>
        ) : (
          <div className="dashboard-grid">
            {agreements.map((agreement) => {
              const now = Math.floor(Date.now() / 1000);
              const isExpired = agreement.startTime > 0 && now >= agreement.startTime + agreement.duration;
              const nextDue = agreement.rentPaidUntil || (agreement.lastRentPaid + 30 * 24 * 60 * 60);
              const daysLeft = Math.ceil((nextDue - now) / (24 * 60 * 60));
              const progress = getProgressPercentage(agreement.startTime, agreement.duration);

              return (
                <div key={agreement.address} className="glass-panel agreement-card">
                  <div className="card-header">
                    <div>
                      <h4 className="card-title">{agreement.propertyAddress || "Unnamed Property"}</h4>
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                        {formatShortAddress(agreement.address, 6)}
                      </span>
                    </div>
                    <span className={`status-badge ${agreement.active ? "status-active" : "status-closed"}`}>
                      {agreement.active && <span className="pulse-dot"></span>}
                      {agreement.active ? "Active" : "Closed"}
                    </span>
                  </div>

                  <div className="card-body">
                    <div className="info-item">
                      <span className="info-label">Monthly Rent</span>
                      <span className="info-val">{ethers.formatEther(agreement.rentAmount)} ETH</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Deposit Locked</span>
                      <span className="info-val">{ethers.formatEther(agreement.securityDeposit)} ETH</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Landlord</span>
                      <span className="info-val address-val">{formatShortAddress(agreement.landlord, 4)}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Lease Duration</span>
                      <span className="info-val">{Math.round(agreement.duration / (24 * 60 * 60))} Days</span>
                    </div>
                  </div>

                  <div style={{ background: "rgba(0,0,0,0.15)", padding: "0.75rem", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                      <span style={{ color: "var(--text-muted)" }}>Next Rent Due:</span>
                      <span style={{ color: daysLeft <= 3 ? "var(--accent-rose)" : "var(--text-secondary)", fontWeight: 600 }}>
                        {daysLeft <= 0 ? "Due Now" : `in ${daysLeft} days`}
                      </span>
                    </div>

                    <div style={{ marginTop: "0.25rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                        <span>Lease Progress</span>
                        <span>{progress}%</span>
                      </div>
                      <div style={{ height: "4px", background: "rgba(255, 255, 255, 0.05)", borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${progress}%`,
                          background: "linear-gradient(90deg, var(--accent-cyan), var(--accent-purple))",
                          borderRadius: "2px"
                        }}></div>
                      </div>
                    </div>
                  </div>

                  <div className="card-actions">
                    {agreement.active ? (
                      <>
                        <button
                          className="btn-primary"
                          style={{ flex: 1, fontSize: "0.85rem", justifyContent: "center" }}
                          onClick={() => onPayRent(agreement.address, agreement.rentAmount)}
                          disabled={loading}
                        >
                          Pay Rent ({ethers.formatEther(agreement.rentAmount)} ETH)
                        </button>
                        {isExpired && (
                          <button
                            className="btn-outline"
                            style={{ flex: 1, fontSize: "0.85rem", justifyContent: "center", borderColor: "var(--accent-amber)", color: "var(--accent-amber)" }}
                            onClick={() => onTriggerExpiry(agreement.address)}
                            disabled={loading}
                          >
                            Trigger Expiry & Refund
                          </button>
                        )}
                      </>
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", width: "100%" }}>
                        Lease Closed
                      </span>
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
