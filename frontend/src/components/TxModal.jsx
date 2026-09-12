import React from "react";
import { CheckCircle, AlertTriangle, ExternalLink, X } from "lucide-react";
import { formatShortAddress } from "../utils/crypto.js";

export default function TxModal({ txStatus, onClose }) {
  if (!txStatus || !txStatus.show) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content glass-panel" style={{ position: "relative", maxWidth: "480px" }}>
        <button
          className="btn-outline"
          style={{ position: "absolute", top: "12px", right: "12px", padding: "0.25rem 0.5rem" }}
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <div style={{ padding: "1.5rem 0.5rem 0.5rem 0.5rem", textAlign: "center" }}>
          {txStatus.state === "pending" && <div className="spinner" style={{ margin: "0 auto 1.5rem auto" }}></div>}

          {txStatus.state === "success" && (
            <div className="icon-circle icon-success" style={{ margin: "0 auto 1.5rem auto" }}>
              <CheckCircle size={36} />
            </div>
          )}

          {txStatus.state === "error" && (
            <div className="icon-circle icon-error" style={{ margin: "0 auto 1.5rem auto" }}>
              <AlertTriangle size={36} />
            </div>
          )}

          <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.25rem" }}>{txStatus.title}</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 1.5rem 0", wordBreak: "break-word" }}>
            {txStatus.message}
          </p>

          {txStatus.txHash && (
            <div style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "0.5rem",
              background: "rgba(0,0,0,0.3)",
              padding: "0.6rem 1rem",
              borderRadius: "8px",
              fontSize: "0.85rem",
              marginBottom: "1.5rem"
            }}>
              <span style={{ color: "var(--text-muted)" }}>Tx:</span>
              <span style={{ fontFamily: "monospace" }}>{formatShortAddress(txStatus.txHash, 6)}</span>
              <a
                href={`https://sepolia.etherscan.io/tx/${txStatus.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent-cyan)", display: "flex", alignItems: "center" }}
                title="View on Explorer"
              >
                <ExternalLink size={14} />
              </a>
            </div>
          )}

          {txStatus.state !== "pending" && (
            <button className="btn-primary" onClick={onClose} style={{ width: "100%", justifyContent: "center" }}>
              Close Window
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
