import React, { useState } from "react";
import { Shield, KeyRound, User, Mail, Lock, CheckCircle2, AlertCircle, X } from "lucide-react";
import api from "../services/api.js";

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [tab, setTab] = useState("login"); // "login", "register", "verify", "forgot"
  
  // Login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register fields
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regRole, setRegRole] = useState("Tenant");

  // Verify fields
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  // Forgot / Reset fields
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetRequested, setResetRequested] = useState(false);

  // Status feedback
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  if (!isOpen) return null;

  const resetState = () => {
    setErrorMsg("");
    setSuccessMsg("");
  };

  const handleQuickLogin = (email, password = "Password@123") => {
    setLoginEmail(email);
    setLoginPassword(password);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    resetState();
    try {
      const data = await api.login(loginEmail, loginPassword);
      setSuccessMsg(`Welcome back, ${data.user?.name || "User"}!`);
      setTimeout(() => {
        onAuthSuccess(data.user);
        onClose();
      }, 600);
    } catch (err) {
      setErrorMsg(err.message || "Failed to log in");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    resetState();
    try {
      const data = await api.register({
        name: regName,
        email: regEmail,
        password: regPassword,
        role: regRole
      });
      setSuccessMsg("Account created! Please enter your verification token.");
      setVerifyEmail(regEmail);
      if (data.verificationToken) {
        setVerifyToken(data.verificationToken);
      }
      setTab("verify");
    } catch (err) {
      setErrorMsg(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    resetState();
    try {
      await api.verifyEmail({ email: verifyEmail, token: verifyToken });
      setSuccessMsg("Account verified successfully! You can now log in.");
      setLoginEmail(verifyEmail);
      setLoginPassword(regPassword || "Password@123");
      setTab("login");
    } catch (err) {
      setErrorMsg(err.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    resetState();
    try {
      const data = await api.forgotPassword(resetEmail);
      setResetRequested(true);
      if (data.resetToken) {
        setResetToken(data.resetToken);
      }
      setSuccessMsg(data.message || "Password reset token generated!");
    } catch (err) {
      setErrorMsg(err.message || "Failed to request reset token");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    resetState();
    try {
      await api.resetPassword({
        email: resetEmail,
        token: resetToken,
        newPassword: resetNewPassword
      });
      setSuccessMsg("Password reset successfully! Please log in.");
      setLoginEmail(resetEmail);
      setTab("login");
    } catch (err) {
      setErrorMsg(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 1100 }}>
      <div className="modal-content glass-panel" style={{ maxWidth: "480px", position: "relative" }}>
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "1.25rem",
            right: "1.25rem",
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            cursor: "pointer"
          }}
        >
          <X size={20} />
        </button>

        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{
            width: "48px",
            height: "48px",
            background: "linear-gradient(135deg, rgba(0,242,254,0.1), rgba(155,81,224,0.1))",
            border: "1px solid var(--border-glow)",
            borderRadius: "12px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent-cyan)",
            marginBottom: "0.75rem"
          }}>
            <Shield size={26} />
          </div>
          <h2 style={{ margin: "0 0 0.25rem 0", fontSize: "1.5rem" }}>RentSphere Access</h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Enterprise Rental SaaS & Smart Contract Architecture
          </p>
        </div>

        {/* Tab Selector */}
        <div style={{ display: "flex", gap: "0.5rem", background: "rgba(255,255,255,0.03)", padding: "4px", borderRadius: "10px", marginBottom: "1.25rem" }}>
          <button
            type="button"
            className={`tab-btn ${tab === "login" ? "active" : ""}`}
            onClick={() => { setTab("login"); resetState(); }}
            style={{ flex: 1, textAlign: "center" }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === "register" ? "active" : ""}`}
            onClick={() => { setTab("register"); resetState(); }}
            style={{ flex: 1, textAlign: "center" }}
          >
            Register
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === "verify" ? "active" : ""}`}
            onClick={() => { setTab("verify"); resetState(); }}
            style={{ flex: 1, textAlign: "center" }}
          >
            Verify
          </button>
        </div>

        {errorMsg && (
          <div style={{
            background: "rgba(244,63,94,0.15)",
            border: "1px solid var(--accent-rose)",
            color: "var(--accent-rose)",
            padding: "0.75rem",
            borderRadius: "8px",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "1rem"
          }}>
            <AlertCircle size={16} />
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div style={{
            background: "rgba(16,185,129,0.15)",
            border: "1px solid var(--accent-emerald)",
            color: "var(--accent-emerald)",
            padding: "0.75rem",
            borderRadius: "8px",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "1rem"
          }}>
            <CheckCircle2 size={16} />
            {successMsg}
          </div>
        )}

        {/* 1. LOGIN TAB */}
        {tab === "login" && (
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className="form-group">
              <label><Mail size={14} style={{ display: "inline", marginRight: "4px" }} /> Email Address</label>
              <input
                type="email"
                className="input-field"
                placeholder="name@example.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label><Lock size={14} style={{ display: "inline", marginRight: "4px" }} /> Password</label>
                <button
                  type="button"
                  onClick={() => { setTab("forgot"); resetState(); }}
                  style={{ background: "none", border: "none", color: "var(--accent-cyan)", fontSize: "0.75rem", cursor: "pointer", padding: 0 }}
                >
                  Forgot Password?
                </button>
              </div>
              <input
                type="password"
                className="input-field"
                placeholder="Enter password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: "0.5rem", width: "100%", justifyContent: "center" }}>
              {loading ? "Authenticating..." : "Sign In to RentSphere"}
            </button>

            {/* Demo Quick Fill (Only displayed in development mode) */}
            {import.meta.env.DEV && (
              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border-color)" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem" }}>
                  Quick Fill Demo Accounts (Password: Password@123):
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <button type="button" className="btn-outline" style={{ fontSize: "0.75rem", padding: "0.4rem" }} onClick={() => handleQuickLogin("landlord@gmail.com")}>
                    🔑 Landlord
                  </button>
                  <button type="button" className="btn-outline" style={{ fontSize: "0.75rem", padding: "0.4rem" }} onClick={() => handleQuickLogin("tenant@gmail.com")}>
                    🔑 Tenant
                  </button>
                  <button type="button" className="btn-outline" style={{ fontSize: "0.75rem", padding: "0.4rem" }} onClick={() => handleQuickLogin("admin@rentsphere.com")}>
                    🔑 Super Admin
                  </button>
                  <button type="button" className="btn-outline" style={{ fontSize: "0.75rem", padding: "0.4rem" }} onClick={() => handleQuickLogin("finance@rentsphere.com")}>
                    🔑 Finance Admin
                  </button>
                </div>
              </div>
            )}
          </form>
        )}

        {/* 2. REGISTER TAB */}
        {tab === "register" && (
          <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className="form-group">
              <label><User size={14} style={{ display: "inline", marginRight: "4px" }} /> Full Name</label>
              <input
                type="text"
                className="input-field"
                placeholder="Jane Doe"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label><Mail size={14} style={{ display: "inline", marginRight: "4px" }} /> Email Address</label>
              <input
                type="email"
                className="input-field"
                placeholder="name@example.com"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label><Lock size={14} style={{ display: "inline", marginRight: "4px" }} /> Password</label>
              <input
                type="password"
                className="input-field"
                placeholder="Min 8 chars, 1 uppercase, 1 lowercase, 1 number"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Account Role</label>
              <select
                className="input-field"
                value={regRole}
                onChange={(e) => setRegRole(e.target.value)}
              >
                <option value="Tenant">Tenant (Rent, sign leases, pay rent)</option>
                <option value="Property Owner">Landlord / Property Owner (List units, deploy leases)</option>
              </select>
            </div>

            <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: "0.5rem", width: "100%", justifyContent: "center" }}>
              {loading ? "Creating Account..." : "Create Account"}
            </button>
          </form>
        )}

        {/* 3. VERIFY TAB */}
        {tab === "verify" && (
          <form onSubmit={handleVerify} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className="form-group">
              <label><Mail size={14} style={{ display: "inline", marginRight: "4px" }} /> Account Email</label>
              <input
                type="email"
                className="input-field"
                placeholder="name@example.com"
                value={verifyEmail}
                onChange={(e) => setVerifyEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label><KeyRound size={14} style={{ display: "inline", marginRight: "4px" }} /> Verification Token</label>
              <input
                type="text"
                className="input-field"
                placeholder="Enter 64-char token received"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: "0.5rem", width: "100%", justifyContent: "center" }}>
              {loading ? "Verifying..." : "Verify & Activate Account"}
            </button>
          </form>
        )}

        {/* 4. FORGOT / RESET PASSWORD */}
        {tab === "forgot" && (
          <div>
            {!resetRequested ? (
              <form onSubmit={handleForgotPassword} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="form-group">
                  <label><Mail size={14} style={{ display: "inline", marginRight: "4px" }} /> Account Email</label>
                  <input
                    type="email"
                    className="input-field"
                    placeholder="name@example.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
                  {loading ? "Generating Token..." : "Request Reset Token"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="form-group">
                  <label><KeyRound size={14} style={{ display: "inline", marginRight: "4px" }} /> Reset Token</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Enter reset token"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label><Lock size={14} style={{ display: "inline", marginRight: "4px" }} /> New Password</label>
                  <input
                    type="password"
                    className="input-field"
                    placeholder="Min 8 chars, 1 uppercase, 1 lowercase, 1 number"
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
                  {loading ? "Updating..." : "Reset Password"}
                </button>
              </form>
            )}

            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <button
                type="button"
                onClick={() => { setTab("login"); resetState(); }}
                style={{ background: "none", border: "none", color: "var(--accent-cyan)", fontSize: "0.85rem", cursor: "pointer" }}
              >
                Back to Sign In
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
