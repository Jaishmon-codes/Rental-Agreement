import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import Navbar from "./components/Navbar.jsx";
import LandlordPanel from "./components/LandlordPanel.jsx";
import TenantPanel from "./components/TenantPanel.jsx";
import PropertiesPanel from "./components/PropertiesPanel.jsx";
import DocumentsPanel from "./components/DocumentsPanel.jsx";
import ExplorePanel from "./components/ExplorePanel.jsx";
import EnterprisePanel from "./components/EnterprisePanel.jsx";
import AuthModal from "./components/AuthModal.jsx";
import WalletOnboardingModal from "./components/WalletOnboardingModal.jsx";
import TxModal from "./components/TxModal.jsx";
import {
  connectWeb3,
  switchToLocalhost,
  fetchAgreementDetails,
  getFactoryContract,
  getAgreementContract
} from "./services/web3.js";
import api, { getToken } from "./services/api.js";

function App() {
  // Web3 Wallet state (Optional decoupled identity)
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("0.0");
  const [networkName, setNetworkName] = useState("");
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(true);

  // User Authentication state
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // App navigation
  const [activeTab, setActiveTab] = useState("properties");
  const [loading, setLoading] = useState(false);

  // Agreements state
  const [landlordAgreements, setLandlordAgreements] = useState([]);
  const [tenantAgreements, setTenantAgreements] = useState([]);
  const [backendAgreements, setBackendAgreements] = useState([]);

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

  // Load user profile on mount if token is saved
  useEffect(() => {
    if (getToken()) {
      api.getProfile()
        .then((profile) => {
          setCurrentUser(profile);
          if (profile.role === "Property Owner") setActiveTab("properties");
          else if (profile.role === "Tenant") setActiveTab("properties");
          else if (["Super Admin", "Finance Admin", "Auditor", "Legal Officer"].includes(profile.role)) setActiveTab("enterprise");
        })
        .catch(() => {
          api.logout();
          setCurrentUser(null);
        });
    }
  }, []);

  // Fetch backend agreements
  const loadBackendAgreements = useCallback(async () => {
    try {
      const list = await api.getAgreements();
      setBackendAgreements(list || []);
    } catch (err) {
      console.error("Failed to load backend agreements:", err);
    }
  }, []);

  useEffect(() => {
    loadBackendAgreements();
  }, [currentUser, loadBackendAgreements]);

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
      return web3;
    } catch (err) {
      console.error(err);
      setLoading(false);
      showTx("error", "Wallet Connection Failed", err.message);
      return null;
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
    if (!provider || !account || !isCorrectNetwork) {
      loadBackendAgreements();
      return;
    }

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
      loadBackendAgreements();
      setLoading(false);
    } catch (err) {
      console.error("Error loading on-chain agreements:", err);
      setLoading(false);
    }
  }, [provider, account, isCorrectNetwork, loadBackendAgreements]);

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
          setAccount(accounts[0]);
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

  // Create Lease (Landlord)
  const handleCreateLease = async ({ propertyAddress, rentEth, depositEth, durationDays, documentHash }) => {
    if (!signer) {
      setIsWalletModalOpen(true);
      return;
    }

    try {
      showTx("pending", "Deploying Agreement", "Waiting for MetaMask confirmation...");
      const factory = getFactoryContract(signer);

      const rentWei = ethers.parseEther(rentEth.toString());
      const depositWei = ethers.parseEther(depositEth.toString());
      const durationSecs = parseInt(durationDays, 10) * 86400;

      const tx = await factory.createAgreement(
        rentWei,
        depositWei,
        durationSecs,
        propertyAddress,
        documentHash
      );

      showTx("pending", "Confirming Deployment", "Awaiting transaction confirmation on blockchain...", tx.hash);
      const receipt = await tx.wait();

      let newContractAddress = "";
      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog(log);
          if (parsed && parsed.name === "AgreementCreated") {
            newContractAddress = parsed.args.agreementContract;
            break;
          }
        } catch {
          // Log not from factory
        }
      }

      // Also record in backend database
      try {
        await api.createAgreement({
          contractAddress: newContractAddress,
          landlordAddress: account || currentUser?.email || "landlord@gmail.com",
          rentInINR: Math.round(parseFloat(rentEth) * 250000),
          securityDepositInINR: Math.round(parseFloat(depositEth) * 250000),
          durationDays: parseInt(durationDays, 10),
          propertyDetails: propertyAddress,
          pdfHash: documentHash
        });
      } catch (dbErr) {
        console.warn("Backend sync notice:", dbErr.message);
      }

      showTx(
        "success",
        "Agreement Deployed Successfully",
        `Contract live at: ${newContractAddress || "Confirmed"}`,
        tx.hash
      );

      loadAgreements();
    } catch (err) {
      console.error(err);
      showTx("error", "Deployment Failed", err.reason || err.message || "Unknown blockchain error");
    }
  };

  // Claim Rent (Landlord)
  const handleClaimRent = async (agreementAddress) => {
    if (!signer) {
      setIsWalletModalOpen(true);
      return;
    }

    try {
      showTx("pending", "Claiming Rent", "Submitting rent claim request...");
      const contract = getAgreementContract(agreementAddress, signer);
      const tx = await contract.claimRent();
      showTx("pending", "Settling Balances", "Awaiting block confirmation...", tx.hash);
      await tx.wait();

      showTx("success", "Rent Claimed Successfully", "Rent has been transferred directly to your wallet.", tx.hash);
      loadAgreements();
      if (exploreDetails?.address === agreementAddress) {
        handleExploreContract(agreementAddress);
      }
    } catch (err) {
      console.error(err);
      showTx("error", "Claim Failed", err.reason || err.message || "Failed to claim rent.");
    }
  };

  // Join Lease (Tenant)
  const handleJoinLease = async (agreementAddress, totalRequiredWei) => {
    if (!signer) {
      setIsWalletModalOpen(true);
      return;
    }

    try {
      showTx("pending", "Signing Lease", "Locking security deposit & first month rent in escrow...");
      const contract = getAgreementContract(agreementAddress, signer);
      const tx = await contract.joinAgreement({ value: totalRequiredWei });
      showTx("pending", "Confirming Lease", "Awaiting block confirmation...", tx.hash);
      await tx.wait();

      showTx("success", "Lease Signed & Active", "You are now the active tenant for this property.", tx.hash);
      loadAgreements();
      if (exploreDetails?.address === agreementAddress) {
        handleExploreContract(agreementAddress);
      }
    } catch (err) {
      console.error(err);
      showTx("error", "Signing Failed", err.reason || err.message || "Could not join lease.");
    }
  };

  // Pay Monthly Rent (Tenant - On Chain)
  const handlePayRent = async (agreementAddress, rentAmount) => {
    if (!signer) {
      setIsWalletModalOpen(true);
      return;
    }

    try {
      showTx("pending", "Paying Monthly Rent", "Transferring rent to agreement balance...");
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
    if (!signer) {
      setIsWalletModalOpen(true);
      return;
    }

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
    if (!signer) {
      setIsWalletModalOpen(true);
      return;
    }

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

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    setActiveTab("properties");
  };

  // Combine on-chain and backend agreements for document vault
  const allAgreements = [
    ...landlordAgreements.map(a => ({ ...a, id: a.address })),
    ...tenantAgreements.map(a => ({ ...a, id: a.address })),
    ...backendAgreements
  ];

  return (
    <div className="app-container">
      {/* Modals */}
      <TxModal txStatus={txStatus} onClose={closeTx} />
      
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          loadBackendAgreements();
        }}
      />

      <WalletOnboardingModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        currentUser={currentUser}
        onWalletLinked={(web3) => {
          setProvider(web3.provider);
          setSigner(web3.signer);
          setAccount(web3.account);
          setBalance(web3.balance);
          setNetworkName(web3.networkName);
          setIsCorrectNetwork(web3.isCorrectNetwork);
        }}
      />

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
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
        onOpenWalletModal={() => setIsWalletModalOpen(true)}
      />

      {/* Main SaaS Content Panels */}
      <main>
        {activeTab === "properties" && (
          <PropertiesPanel
            currentUser={currentUser}
            onDraftAgreementForUnit={() => setActiveTab("landlord")}
          />
        )}

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

        {activeTab === "documents" && (
          <DocumentsPanel
            currentUser={currentUser}
            agreements={allAgreements.length > 0 ? allAgreements : [{ id: "agreement_001", property_details: "742 Evergreen Terrace" }]}
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
    </div>
  );
}

export default App;
