import express from "express";
import {
  generateWalletNonce,
  verifyWalletSignature,
  getUserWallets,
  unlinkWallet
} from "../services/wallet/walletService.js";

const router = express.Router();

export default function createWalletRouter({ authenticateToken }) {
  /**
   * POST /api/wallet/nonce
   * Generates a one-time cryptographic challenge nonce for the wallet address
   */
  router.post("/nonce", authenticateToken, async (req, res) => {
    try {
      const { walletAddress } = req.body;
      const result = await generateWalletNonce({
        userId: req.user.id,
        walletAddress,
        req
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  /**
   * POST /api/wallet/verify
   * Verifies EIP-191 personal signature and securely links wallet
   */
  router.post("/verify", authenticateToken, async (req, res) => {
    try {
      const { walletAddress, signature } = req.body;
      const result = await verifyWalletSignature({
        userId: req.user.id,
        userEmail: req.user.email,
        walletAddress,
        signature,
        req
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  /**
   * GET /api/wallet/me
   * Lists all verified wallets for the logged-in user
   */
  router.get("/me", authenticateToken, (req, res) => {
    try {
      const wallets = getUserWallets(req.user.id);
      res.json(wallets);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/wallet/:address
   * Unlinks a wallet from the logged-in user's account
   */
  router.delete("/:address", authenticateToken, (req, res) => {
    try {
      const result = unlinkWallet({
        userId: req.user.id,
        userEmail: req.user.email,
        walletAddress: req.params.address,
        req
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  return router;
}
