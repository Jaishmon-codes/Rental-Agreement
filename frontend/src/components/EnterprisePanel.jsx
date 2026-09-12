import React, { useState, useEffect } from "react";
import { Shield, RefreshCw, CheckCircle, AlertTriangle, Terminal, Lock, LogIn } from "lucide-react";
import api, { setToken, getToken } from "../services/api.js";

export default function EnterprisePanel() {
  const [currentUser, setCurrentUser] = useState(null);
  const [emailInput, setEmailInput] = useState("admin@rentsphere.com");
  const [passwordInput, setPasswordInput] = useState("Password@123");
  const [authError, setAuthError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [stats, setStats] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Integrity Verifier state
  const [verifyId, setVerifyId] = useState("agreement_001");
  const [verifyHash, setVerifyHash] = useState("a2b585dd299e03d12FA4293BC5de4111afa1a4b94908f83103eb1f1706367c2e6");
  const [verifyResult, setVerifyResult] = useState(null);

  // Auto-check existing profile on mount
  useEffect(() => {
    if (getToken()) {
      api.getProfile()
        .then((user) => {
          setCurrentUser(user);
          loadDashboardData(user.role);
        })
        .catch(() => {
          setToken("");
          setCurrentUser(null);
        });
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    setLoginLoading(true);

    try {
      const res = await api.login(emailInput, passwordInput);
      setCurrentUser(res.user);
      loadDashboardData(res.user.role);
      setLoginLoading(false);
    } catch (err) {
      setAuthError(err.message || "Login failed");
      setLoginLoading(false);
    }
  };

  const handleRoleQuickSelect = (roleEmail) => {
    setEmailInput(roleEmail);
    setPasswordInput("Password@123");
  };

  const loadDashboardData = async (role) => {
    try {
      if (role === "Super Admin" || role === "Auditor" || role === "Legal Officer") {
        const statsData = await api.getStats().catch(() => null);
        if (statsData) setStats(statsData);
      }
      if (role === "Super Admin" || role === "Auditor") {
        loadAuditLogs();
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    }
  };

  const loadAuditLogs = async () => {
    try {
      setLogsLoading(true);
      const logs = await api.getAuditTrail(30);
      setAuditLogs(logs);
      setLogsLoading(false);
    } catch (err) {
      console.error("Failed to load audit logs:", err);
      setLogsLoading(false);
    }
  };

  const handleVerifyIntegrity = async (e) => {
    e.preventDefault();
    try {
      const result = await api.verifyAgreement(verifyId, verifyHash);
      setVerifyResult(result);
    } catch (err) {
      alert("Verification failed: " + err.message);
    }
  };

  const handleLogout = () => {
    setToken("");
    setCurrentUser(null);
    setStats(null);
    setAuditLogs([]);
    setVerifyResult(null);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem", alignItems: "start" }}>
      {/* Left Column: Login / Role Profile */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div className="glass-panel" style={{ padding: "1.5rem" }}>
          <h3 style={{ marginTop: 0, marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Shield size={20} style={{ color: "var(--accent-purple)" }} />
            SaaS Authentication (RBAC)
          </h3>

          {!currentUser ? (
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label">Quick Role Presets</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                    onClick={() => handleRoleQuickSelect("admin@rentsphere.com")}
                  >
                    Super Admin
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                    onClick={() => handleRoleQuickSelect("legal@rentsphere.com")}
                  >
                    Legal Officer
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                    onClick={() => handleRoleQuickSelect("auditor@rentsphere.com")}
                  >
                    Auditor
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  className="form-input"
                  required
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  required
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                />
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
                  Default demo password: <code>Password@123</code>
                </span>
              </div>

              {authError && (
                <div style={{ color: "var(--accent-rose)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                  {authError}
                </div>
              )}

              <button className="btn-primary" type="submit" style={{ width: "100%", justifyContent: "center" }} disabled={loginLoading}>
                <LogIn size={16} />
                {loginLoading ? "Authenticating..." : "Login to Enterprise SaaS"}
              </button>
            </form>
          ) : (
            <div>
              <div style={{
                background: "rgba(0,0,0,0.2)",
                padding: "1rem",
                borderRadius: "8px",
                marginBottom: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Logged In As:</span>
                  <span style={{ fontWeight: 600 }}>{currentUser.name}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Role:</span>
                  <span className="status-badge status-active">{currentUser.role}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Email:</span>
                  <span style={{ fontSize: "0.85rem", fontFamily: "monospace" }}>{currentUser.email}</span>
                </div>
              </div>

              <button
                className="btn-outline"
                style={{ width: "100%", justifyContent: "center", borderColor: "rgba(244, 63, 94, 0.4)", color: "var(--accent-rose)" }}
                onClick={handleLogout}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>

        {/* REST API Endpoints Guide */}
        <div className="glass-panel" style={{ padding: "1.25rem" }}>
          <h4 style={{ margin: "0 0 0.75rem 0", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.95rem" }}>
            <Terminal size={16} style={{ color: "var(--accent-cyan)" }} />
            Active REST API Endpoints
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.75rem", fontFamily: "monospace" }}>
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(16,185,129,0.08)", padding: "0.4rem 0.6rem", borderRadius: "4px" }}>
              <span style={{ color: "var(--accent-emerald)" }}>POST /api/auth/login</span>
              <span>Bcrypt JWT Auth</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,242,254,0.08)", padding: "0.4rem 0.6rem", borderRadius: "4px" }}>
              <span style={{ color: "var(--accent-cyan)" }}>GET /api/agreements</span>
              <span>List Leases</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(16,185,129,0.08)", padding: "0.4rem 0.6rem", borderRadius: "4px" }}>
              <span style={{ color: "var(--accent-emerald)" }}>POST /api/verifyAgreement</span>
              <span>SHA-256 Engine</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(155,81,224,0.08)", padding: "0.4rem 0.6rem", borderRadius: "4px" }}>
              <span style={{ color: "var(--accent-purple)" }}>GET /api/audit-trail</span>
              <span>RBAC Immutable Logs</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Dynamic Role Views */}
      <div className="glass-panel" style={{ padding: "2rem" }}>
        {!currentUser ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-secondary)" }}>
            <Lock size={48} style={{ opacity: 0.3, marginBottom: "1rem" }} />
            <h3>Enterprise SaaS Console Locked</h3>
            <p style={{ maxWidth: "420px", margin: "0 auto" }}>
              Please select a role preset and log in on the left to access compliance dashboards, integrity verifications, and audit trails.
            </p>
          </div>
        ) : (
          <div>
            {/* Super Admin Analytics */}
            {currentUser.role === "Super Admin" && stats && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: "1.5rem" }}>Super Admin SaaS Metrics</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
                  <div style={{ background: "rgba(255,255,255,0.02)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>Total Agreements</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "var(--accent-cyan)", fontFamily: "Space Grotesk" }}>
                      {stats.totalAgreements}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>Active Leases</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "var(--accent-emerald)", fontFamily: "Space Grotesk" }}>
                      {stats.activeAgreements}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>Audit Events</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "var(--accent-purple)", fontFamily: "Space Grotesk" }}>
                      {stats.totalLogs}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>System Uptime</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "var(--accent-emerald)", fontFamily: "Space Grotesk" }}>
                      {stats.uptimePercent}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Legal Officer Document Verification Form */}
            {(currentUser.role === "Legal Officer" || currentUser.role === "Super Admin") && (
              <div style={{ marginBottom: "2rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "1rem" }}>Legal Document Integrity Engine</h3>
                <form onSubmit={handleVerifyIntegrity} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1rem" }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Agreement ID or Contract Address</label>
                    <input
                      className="form-input"
                      type="text"
                      required
                      value={verifyId}
                      onChange={(e) => setVerifyId(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Provided Physical PDF SHA-256 Hash</label>
                    <input
                      className="form-input"
                      type="text"
                      required
                      value={verifyHash}
                      onChange={(e) => setVerifyHash(e.target.value)}
                    />
                  </div>
                  <button className="btn-primary" type="submit" style={{ justifyContent: "center" }}>
                    Run Verification
                  </button>
                </form>

                {verifyResult && (
                  <div style={{
                    background: verifyResult.isValid ? "rgba(16,185,129,0.1)" : "rgba(244,63,94,0.1)",
                    border: `1px solid ${verifyResult.isValid ? "var(--accent-emerald)" : "var(--accent-rose)"}`,
                    padding: "1rem",
                    borderRadius: "8px",
                    fontSize: "0.85rem"
                  }}>
                    <div style={{
                      fontWeight: 700,
                      color: verifyResult.isValid ? "var(--accent-emerald)" : "var(--accent-rose)",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginBottom: "0.5rem"
                    }}>
                      {verifyResult.isValid ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                      {verifyResult.isValid ? "INTEGRITY CONFIRMED — PASSED" : "INTEGRITY FAILED — DOCUMENT MISMATCH"}
                    </div>
                    <div style={{ wordBreak: "break-all" }}><strong>Registered:</strong> {verifyResult.registeredHash}</div>
                    <div style={{ wordBreak: "break-all" }}><strong>Provided:</strong> {verifyResult.providedHash}</div>
                  </div>
                )}
              </div>
            )}

            {/* Auditor Security Audit Trail */}
            {(currentUser.role === "Auditor" || currentUser.role === "Super Admin") && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <h3 style={{ margin: 0 }}>Security Audit Trail Logs</h3>
                  <button className="btn-outline" style={{ padding: "0.4rem 0.75rem", fontSize: "0.85rem" }} onClick={loadAuditLogs} disabled={logsLoading}>
                    <RefreshCw size={14} className={logsLoading ? "spin" : ""} /> Refresh
                  </button>
                </div>

                {auditLogs.length === 0 ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
                    No audit records logged yet.
                  </div>
                ) : (
                  <div style={{ maxHeight: "350px", overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", textAlign: "left" }}>
                      <thead>
                        <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--border-color)" }}>
                          <th style={{ padding: "0.75rem" }}>Timestamp</th>
                          <th style={{ padding: "0.75rem" }}>Event Action</th>
                          <th style={{ padding: "0.75rem" }}>User</th>
                          <th style={{ padding: "0.75rem" }}>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr key={log.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                            <td style={{ padding: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                              {new Date(log.created_at).toLocaleTimeString()}
                            </td>
                            <td style={{ padding: "0.75rem" }}>
                              <span style={{
                                color: log.action.includes("FAILED") || log.action.includes("ALERT") ? "var(--accent-rose)" : "var(--accent-cyan)",
                                fontWeight: 600
                              }}>
                                {log.action}
                              </span>
                            </td>
                            <td style={{ padding: "0.75rem", color: "var(--text-secondary)" }}>
                              {log.user_email || "System"}
                            </td>
                            <td style={{ padding: "0.75rem", color: "var(--text-secondary)" }}>
                              {log.description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
