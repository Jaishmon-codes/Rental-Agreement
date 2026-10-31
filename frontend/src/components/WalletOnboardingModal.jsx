import React, { useState, useEffect, useCallback } from "react";
import { Wallet, ShieldCheck, CheckCircle2, AlertCircle, Trash2, X, RefreshCw } from "lucide-react";
import { connectWeb3 } from "../services/web3.js";
import api from "../services/api.js";
import { formatShortAddress } from "../utils/crypto.js";

export default function WalletOnboardingModal({ isOpen, onClose, currentUser, onWalletLinked }) {
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const fetchWallets = useCallback(async () => {
    if (!currentUser) return;
    try {
      const list = await api.getUserWallets();
      setWallets(list || []);
    } catch (err) {
      console.error("Failed to load user wallets:", err);
    }
  }, [currentUser]);

  useEffect(() => {
    if (isOpen && currentUser) {
      fetchWallets();
      setErrorMsg("");
      setSuccessMsg("");
    }
  }, [isOpen, currentUser, fetchWallets]);

  if (!isOpen) return null;

  const handleConnectAndLink = async () => {
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      // 1. Connect Web3 Provider
      const web3 = await connectWeb3();
      const walletAddress = web3.account;

      // 2. Request Cryptographic Nonce
      const nonceData = await api.getWalletNonce(walletAddress);

      // 3. Request EIP-191 Personal Signature from User
      const signature = await web3.signer.signMessage(nonceData.message);

      // 4. Submit Signature for Verification on RentSphere Backend
      await api.verifyWalletSignature({
        walletAddress,
        signature
      });

      setSuccessMsg(`Wallet ${formatShortAddress(walletAddress)} linked & verified!`);
      await fetchWallets();
      if (onWalletLinked) {
        onWalletLinked(web3);
      }
    } catch (err) {
      console.error("Wallet linking failed:", err);
      setErrorMsg(err.reason || err.message || "Failed to link wallet");
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async (address) => {
    if (!window.confirm(`Are you sure you want to unlink wallet ${formatShortAddress(address)}?`)) {
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      await api.unlinkWallet(address);
      setSuccessMsg(`Wallet ${formatShortAddress(address)} unlinked.`);
      await fetchWallets();
    } catch (err) {
      setErrorMsg(err.message || "Failed to unlink wallet");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 1100 }}>
      <div className="modal-content glass-panel" style={{ maxWidth: "500px", position: "relative" }}>
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
            <Wallet size={26} />
          </div>
          <h2 style={{ margin: "0 0 0.25rem 0", fontSize: "1.5rem" }}>Decoupled Web3 Wallet</h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Link your EVM address via cryptographic signature to sign on-chain contracts
          </p>
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

        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Linked Wallets</span>
            <button
              type="button"
              onClick={fetchWallets}
              style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem" }}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {wallets.length === 0 ? (
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed var(--border-color)",
              borderRadius: "10px",
              padding: "1.25rem",
              textAlign: "center",
              fontSize: "0.85rem",
              color: "var(--text-secondary)"
            }}>
              No EVM wallets currently linked. Fiat payments and standard rental operations work without a wallet. Link a wallet whenever you want to deploy or sign smart contracts.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {wallets.map((w) => (
                <div key={w.id} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  padding: "0.75rem 1rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <ShieldCheck size={18} style={{ color: "var(--accent-emerald)" }} />
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.85rem", fontWeight: 600 }}>
                        {formatShortAddress(w.wallet_address)}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                        {w.network || "Sepolia / Localhost"} • Verified
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnlink(w.wallet_address)}
                    style={{
                      background: "rgba(244,63,94,0.1)",
                      border: "none",
                      color: "var(--accent-rose)",
                      padding: "0.4rem 0.6rem",
                      borderRadius: "6px",
                      cursor: "pointer"
                    }}
                    title="Unlink Wallet"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={handleConnectAndLink}
          disabled={loading}
          className="btn-primary"
          style={{ width: "100%", justifyContent: "center", fontSize: "0.95rem", padding: "0.85rem" }}
        >
          <Wallet size={18} />
          {loading ? "Verifying Signature..." : "Connect & Link New Wallet"}
        </button>

        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "0.85rem", cursor: "pointer" }}
          >
            Continue Without Web3 Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
