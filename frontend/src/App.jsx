import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import Navbar from "./components/Navbar.jsx";
import LandlordPanel from "./components/LandlordPanel.jsx";
import TenantPanel from "./components/TenantPanel.jsx";
import ExplorePanel from "./components/ExplorePanel.jsx";
import EnterprisePanel from "./components/EnterprisePanel.jsx";
import TxModal from "./components/TxModal.jsx";
import {
  connectWeb3,
  switchToLocalhost,
  fetchAgreementDetails,
  getFactoryContract,
  getAgreementContract
} from "./services/web3.js";
import api, { getToken } from "./services/api.js";
import { Building, Wallet } from "lucide-react";

function App() {
  // Web3 Wallet state
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("0.0");
  const [networkName, setNetworkName] = useState("");
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(true);

  // App navigation
  const [activeTab, setActiveTab] = useState("landlord");
  const [loading, setLoading] = useState(false);

  // Agreements state
  const [landlordAgreements, setLandlordAgreements] = useState([]);
  const [tenantAgreements, setTenantAgreements] = useState([]);

  // Universal explorer state
  const [exploreDetails, setExploreDetails] = useState(null);
  const [exploreError, setExploreError] = useState("");

  // Transaction feedback modal
  const [txStatus, setTxStatus] = useState({
    show: false,
    state: "pending",
    title: "",
    message: "",
    txHash: ""
  });

  const showTx = (state, title, message, txHash = "") => {
    setTxStatus({ show: true, state, title, message, txHash });
  };

  const closeTx = () => {
    setTxStatus((prev) => ({ ...prev, show: false }));
  };

  // Connect Wallet
  const handleConnectWallet = async () => {
    try {
      setLoading(true);
      const web3 = await connectWeb3();
      setProvider(web3.provider);
      setSigner(web3.signer);
      setAccount(web3.account);
      setBalance(web3.balance);
      setNetworkName(web3.networkName);
      setIsCorrectNetwork(web3.isCorrectNetwork);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
      showTx("error", "Wallet Connection Failed", err.message);
    }
  };

  // Switch to Localhost (1337)
  const handleSwitchNetwork = async () => {
    try {
      await switchToLocalhost();
    } catch (err) {
      console.error("Network switch error:", err);
    }
  };

  // Refresh and load on-chain agreements
  const loadAgreements = useCallback(async () => {
    if (!provider || !account || !isCorrectNetwork) return;

    try {
      setLoading(true);
      const factory = getFactoryContract(provider);

      const landlordAddrs = await factory.getLandlordAgreements(account).catch(() => []);
      const tenantAddrs = await factory.getTenantAgreements(account).catch(() => []);

      const [landlordData, tenantData] = await Promise.all([
        Promise.all(landlordAddrs.map((addr) => fetchAgreementDetails(addr, provider).catch(() => null))),
        Promise.all(tenantAddrs.map((addr) => fetchAgreementDetails(addr, provider).catch(() => null)))
      ]);

      setLandlordAgreements(landlordData.filter(Boolean));
      setTenantAgreements(tenantData.filter(Boolean));
      setLoading(false);
    } catch (err) {
      console.error("Error loading agreements:", err);
      setLoading(false);
    }
  }, [provider, account, isCorrectNetwork]);

  useEffect(() => {
    if (account && provider && isCorrectNetwork) {
      loadAgreements();
    }
  }, [account, provider, isCorrectNetwork, loadAgreements]);

  // Account change listeners
  useEffect(() => {
    if (window.ethereum) {
      const handleAccountsChanged = (accounts) => {
        if (accounts.length > 0) {
          handleConnectWallet();
        } else {
          setAccount("");
          setSigner(null);
          setBalance("0.0");
        }
      };

      const handleChainChanged = () => {
        window.location.reload();
      };

      window.ethereum.on("accountsChanged", handleAccountsChanged);
      window.ethereum.on("chainChanged", handleChainChanged);

      return () => {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
        window.ethereum.removeListener("chainChanged", handleChainChanged);
      };
    }
  }, []);

  // Deploy New Smart Lease
  const handleCreateLease = async ({ propertyAddress, rentEth, depositEth, durationDays, documentHash }) => {
    if (!signer) return;

    try {
      showTx("pending", "Initiating Deployment", "Broadcasting new rental agreement deployment transaction...");

      const factory = getFactoryContract(signer);
      const rentWei = ethers.parseEther(rentEth.toString());
      const depositWei = ethers.parseEther(depositEth.toString());
      const duration = BigInt(durationDays);

      const tx = await factory.createAgreement(
        rentWei,
        depositWei,
        duration,
        propertyAddress,
        documentHash
      );

      showTx("pending", "Confirming Deployment", "Awaiting block confirmation on the blockchain...", tx.hash);
      const receipt = await tx.wait();

      // Parse deployed address from log
      let deployedAddr = "";
      const eventLog = receipt.logs.find(
        (log) => factory.interface.parseLog(log)?.name === "AgreementCreated"
      );
      if (eventLog) {
        deployedAddr = factory.interface.parseLog(eventLog).args.agreementAddress;
      }

      // Sync metadata with backend if available
      if (getToken()) {
        await api.createAgreement({
          companyId: "Company_A",
          contractAddress: deployedAddr,
          landlordAddress: account,
          rentInINR: Math.round(parseFloat(rentEth) * 250000),
          securityDepositInINR: Math.round(parseFloat(depositEth) * 250000),
          durationDays: parseInt(durationDays, 10),
          propertyDetails: propertyAddress,
          pdfHash: documentHash
        }).catch((err) => console.warn("Backend sync failed:", err.message));
      }

      showTx("success", "Smart Lease Deployed", "Your rental agreement contract is active on-chain.", tx.hash);
      loadAgreements();
    } catch (err) {
      console.error(err);
      showTx("error", "Deployment Failed", err.reason || err.message || "Failed to deploy contract.");
    }
  };

  // Join Lease as Tenant
  const handleJoinLease = async (agreementAddress, rentAmount, securityDeposit) => {
    if (!signer) return;

    try {
      showTx("pending", "Depositing Funds", "Sending first month's rent and security deposit into escrow...");

      const contract = getAgreementContract(agreementAddress, signer);
      const totalAmount = rentAmount + securityDeposit;

      const tx = await contract.joinAsTenant({ value: totalAmount });
      showTx("pending", "Processing Transaction", "Awaiting block confirmation...", tx.hash);
      await tx.wait();

      showTx("success", "Lease Successfully Signed", "You have signed the lease and deposited funds into escrow.", tx.hash);
      loadAgreements();
      handleExploreContract(agreementAddress);
    } catch (err) {
      console.error(err);
      showTx("error", "Failed to Join Lease", err.reason || err.message || "Could not complete lease signature.");
    }
  };

  // Claim Rent (Landlord)
  const handleClaimRent = async (agreementAddress) => {
    if (!signer) return;

    try {
      showTx("pending", "Claiming Rent", "Withdrawing available rent balance from contract vault...");

      const contract = getAgreementContract(agreementAddress, signer);
      const tx = await contract.claimRent();
      showTx("pending", "Withdrawing Funds", "Transferring rent to your wallet address...", tx.hash);
      await tx.wait();

      showTx("success", "Rent Claimed Successfully", "Rent has been transferred to your wallet.", tx.hash);
      loadAgreements();
      if (exploreDetails?.address === agreementAddress) {
        handleExploreContract(agreementAddress);
      }
    } catch (err) {
      console.error(err);
      showTx("error", "Claim Failed", err.reason || err.message || "No rent available to claim.");
    }
  };

  // Pay Next Month Rent (Tenant)
  const handlePayRent = async (agreementAddress, rentAmount) => {
    if (!signer) return;

    try {
      showTx("pending", "Paying Monthly Rent", "Sending rent payment to the agreement vault...");

      const contract = getAgreementContract(agreementAddress, signer);
      const tx = await contract.payNextRent({ value: rentAmount });
      showTx("pending", "Processing Payment", "Awaiting confirmation on the blockchain...", tx.hash);
      await tx.wait();

      showTx("success", "Rent Paid Successfully", "Your rent payment has been credited to the agreement ledger.", tx.hash);
      loadAgreements();
      if (exploreDetails?.address === agreementAddress) {
        handleExploreContract(agreementAddress);
      }
    } catch (err) {
      console.error(err);
      showTx("error", "Payment Failed", err.reason || err.message || "Could not process rent payment.");
    }
  };

  // End Agreement (Landlord)
  const handleEndLease = async (agreementAddress, propertyOk) => {
    if (!signer) return;

    try {
      const actionText = propertyOk ? "Refund Security Deposit" : "Forfeit Security Deposit";
      showTx("pending", "Terminating Lease", `Closing contract with action: ${actionText}...`);

      const contract = getAgreementContract(agreementAddress, signer);
      const tx = await contract.endAgreement(propertyOk);
      showTx("pending", "Settling Balances", "Executing deposit refund on-chain...", tx.hash);
      await tx.wait();

      showTx("success", "Lease Terminated", `Agreement terminated. Deposit settled: ${actionText}.`, tx.hash);
      loadAgreements();
      if (exploreDetails?.address === agreementAddress) {
        handleExploreContract(agreementAddress);
      }
    } catch (err) {
      console.error(err);
      showTx("error", "Termination Failed", err.reason || err.message || "Could not terminate lease.");
    }
  };

  // Auto-Expire (Tenant / Anyone after duration)
  const handleTriggerExpiry = async (agreementAddress) => {
    if (!signer) return;

    try {
      showTx("pending", "Executing Lease Expiry", "Deactivating contract and executing automated deposit refund...");

      const contract = getAgreementContract(agreementAddress, signer);
      const tx = await contract.autoExpire();
      showTx("pending", "Processing Refund", "Awaiting block confirmation...", tx.hash);
      await tx.wait();

      showTx("success", "Lease Expired & Refunded", "Lease completed and security deposit refunded to tenant.", tx.hash);
      loadAgreements();
      if (exploreDetails?.address === agreementAddress) {
        handleExploreContract(agreementAddress);
      }
    } catch (err) {
      console.error(err);
      showTx("error", "Expiry Failed", err.reason || err.message || "Duration has not elapsed yet.");
    }
  };

  // Explore any agreement by address
  const handleExploreContract = async (address) => {
    setExploreError("");
    setExploreDetails(null);

    if (!ethers.isAddress(address)) {
      setExploreError("Invalid Ethereum address format.");
      return;
    }

    try {
      setLoading(true);
      const activeProvider = provider || new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const details = await fetchAgreementDetails(address, activeProvider);
      setExploreDetails(details);
      setLoading(false);
    } catch (err) {
      console.error("Contract inspection error:", err);
      setExploreError("No active Rental Agreement contract found at this address.");
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Transaction Modal */}
      <TxModal txStatus={txStatus} onClose={closeTx} />

      {/* Navbar */}
      <Navbar
        account={account}
        balance={balance}
        networkName={networkName}
        isCorrectNetwork={isCorrectNetwork}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onConnect={handleConnectWallet}
        onSwitchNetwork={handleSwitchNetwork}
        loading={loading}
      />

      {/* Main Content */}
      {!account && activeTab !== "explore" && activeTab !== "enterprise" ? (
        <main className="glass-panel" style={{ padding: "4rem 2rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem" }}>
          <div style={{
            background: "linear-gradient(135deg, rgba(0,242,254,0.1), rgba(155,81,224,0.1))",
            border: "1px solid var(--border-glow)",
            borderRadius: "50%",
            padding: "2rem",
            color: "var(--accent-cyan)"
          }}>
            <Building size={64} />
          </div>
          <h1 style={{
            fontSize: "2.5rem",
            margin: 0,
            background: "linear-gradient(135deg, #fff, #94a3b8)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>
            Decentralized Smart Leases
          </h1>
          <p style={{ maxWidth: "600px", color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
            Sign, deploy, pay, and settle rental agreements securely using cryptographically enforced Ethereum smart contracts.
            Automate monthly rent, isolate security deposits in escrow, and authenticate physical lease documents using real-time SHA-256 verification.
          </p>
          <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
            <button className="btn-primary" onClick={handleConnectWallet} style={{ fontSize: "1rem", padding: "0.85rem 1.75rem" }}>
              <Wallet size={18} />
              Connect Web3 Wallet
            </button>
            <button className="btn-outline" onClick={() => setActiveTab("explore")} style={{ fontSize: "1rem", padding: "0.85rem 1.75rem" }}>
              Explore Public Contracts
            </button>
          </div>
        </main>
      ) : (
        <main>
          {activeTab === "landlord" && (
            <LandlordPanel
              agreements={landlordAgreements}
              onCreateLease={handleCreateLease}
              onClaimRent={handleClaimRent}
              onEndLease={handleEndLease}
              onRefresh={loadAgreements}
              loading={loading}
              isCorrectNetwork={isCorrectNetwork}
            />
          )}

          {activeTab === "tenant" && (
            <TenantPanel
              agreements={tenantAgreements}
              account={account}
              onJoinLease={handleJoinLease}
              onPayRent={handlePayRent}
              onTriggerExpiry={handleTriggerExpiry}
              onRefresh={loadAgreements}
              onExploreContract={handleExploreContract}
              exploreDetails={exploreDetails}
              exploreError={exploreError}
              loading={loading}
            />
          )}

          {activeTab === "explore" && (
            <ExplorePanel
              onExplore={handleExploreContract}
              exploreDetails={exploreDetails}
              exploreError={exploreError}
              loading={loading}
            />
          )}

          {activeTab === "enterprise" && (
            <EnterprisePanel />
          )}
        </main>
      )}
    </div>
  );
}

export default App;
