import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { RENTAL_AGREEMENT_FACTORY_ABI, RENTAL_AGREEMENT_ABI } from "./contracts/abis";
import { CONTRACT_ADDRESSES } from "./contracts/contractAddress";
import { 
  Wallet, Shield, Building, User, Info, FileText, Calendar, 
  DollarSign, CheckCircle, AlertTriangle, ExternalLink, X, Plus, Search, RefreshCw 
} from "lucide-react";

function App() {
  // Connection states
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("0.0");
  const [network, setNetwork] = useState("");
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(true);

  // Business states
  const [activeTab, setActiveTab] = useState("landlord");
  const [landlordAgreements, setLandlordAgreements] = useState([]);
  const [tenantAgreements, setTenantAgreements] = useState([]);
  const [loading, setLoading] = useState(false);

  // Global Explorer state
  const [exploreAddress, setExploreAddress] = useState("");
  const [exploreDetails, setExploreDetails] = useState(null);
  const [exploreError, setExploreError] = useState("");

  // Form input states
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [duration, setDuration] = useState("");
  const [propAddr, setPropAddr] = useState("");
  const [docHash, setDocHash] = useState("");

  // Transaction Feedback states
  const [txStatus, setTxStatus] = useState({
    show: false,
    state: "pending", // pending, success, error
    title: "",
    message: "",
    txHash: ""
  });

  // INR Payment Gateway States
  const [ethToInrRate, setEthToInrRate] = useState(250000); // 1 ETH = ₹2,50,000 baseline fallback
  const [paymentModal, setPaymentModal] = useState({
    show: false,
    type: "join", // join, pay
    agreementAddr: "",
    rentVal: 0n,
    depositVal: 0n,
    step: "select", // select, upi, processing, success
    inrAmount: 0
  });
  const [upiIdInput, setUpiIdInput] = useState("");
  const [selectedBank, setSelectedBank] = useState("SBI");

  // Enterprise / SaaS States
  const [saasOrg, setSaasOrg] = useState("DLF Limited");
  const [saasRole, setSaasRole] = useState("Super Admin");
  const [authToken, setAuthToken] = useState("");
  const [apiLogs, setApiLogs] = useState([
    { timestamp: new Date().toLocaleTimeString(), method: "SYSTEM", endpoint: "Gateway initialized on port 4000", status: "INFO", details: "Ready to route enterprise REST requests." }
  ]);
  const [integrityAddress, setIntegrityAddress] = useState("");
  const [integrityHash, setIntegrityHash] = useState("");
  const [integrityResult, setIntegrityResult] = useState(null);
  const [remoteAuditLogs, setRemoteAuditLogs] = useState([]);

  // Helper to log API requests inside the UI Terminal
  const addApiLog = (method, endpoint, status, details = "") => {
    setApiLogs(prev => [
      { timestamp: new Date().toLocaleTimeString(), method, endpoint, status, details },
      ...prev.slice(0, 14) // Keep last 15 logs
    ]);
  };

  // Login to Backend and retrieve JWT (Requirement 2, 19)
  const fetchBackendToken = async (role) => {
    const roleEmails = {
      "Super Admin": "admin@rentsphere.com",
      "Legal Officer": "legal@rentsphere.com",
      "Property Owner": "landlord@gmail.com",
      "Tenant": "tenant@gmail.com",
      "Auditor": "auditor@rentsphere.com"
    };
    const email = roleEmails[role] || "admin@rentsphere.com";
    try {
      const res = await fetch("http://localhost:4000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "any" })
      });
      const data = await res.json();
      if (data.token) {
        setAuthToken(data.token);
        addApiLog("POST", "/api/auth/login", "200 OK", `Logged in as ${role}. Token loaded.`);
        return data.token;
      }
    } catch (err) {
      console.error(err);
      addApiLog("POST", "/api/auth/login", "ERR", "Failed to connect to backend server.");
    }
    return "";
  };

  // Fetch Audit Trail logs from backend (Requirement 6, 19)
  const fetchAuditLogs = async (token = authToken) => {
    const currentToken = token || authToken;
    if (!currentToken) return;
    try {
      const res = await fetch("http://localhost:4000/api/audit-trail", {
        method: "GET",
        headers: { "Authorization": `Bearer ${currentToken}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setRemoteAuditLogs(data);
        addApiLog("GET", "/api/audit-trail", "200 OK", `Fetched ${data.length} audit logs.`);
      } else {
        addApiLog("GET", "/api/audit-trail", "403 Forbidden", "Insufficient role permissions.");
      }
    } catch (err) {
      console.error(err);
      addApiLog("GET", "/api/audit-trail", "ERR", "Failed to fetch logs.");
    }
  };

  // Verify Document integrity (Requirement 4, 19)
  const verifyDocIntegrity = async () => {
    if (!integrityAddress || !integrityHash) {
      alert("Please provide both the Agreement address/ID and Document Hash.");
      return;
    }
    try {
      const res = await fetch("http://localhost:4000/api/verifyAgreement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreementId: integrityAddress, providedPdfHash: integrityHash })
      });
      const data = await res.json();
      setIntegrityResult(data);
      addApiLog("POST", "/api/verifyAgreement", "200 OK", `Integrity: ${data.isValid ? "VALID" : "INVALID"}`);
    } catch (err) {
      console.error(err);
      addApiLog("POST", "/api/verifyAgreement", "ERR", "Verification request failed.");
    }
  };

  // Auto-login to backend on startup or when role switches
  useEffect(() => {
    if (account) {
      fetchBackendToken(saasRole).then(token => {
        if (token && (saasRole === "Super Admin" || saasRole === "Auditor")) {
          fetchAuditLogs(token);
        }
      });
    }
  }, [saasRole, account]);

  // Fetch Live CoinGecko Exchange Rate (ETH/INR)
  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr")
      .then((res) => res.json())
      .then((data) => {
        if (data.ethereum && data.ethereum.inr) {
          setEthToInrRate(data.ethereum.inr);
          console.log("Fetched live ETH/INR rate:", data.ethereum.inr);
        }
      })
      .catch((err) => console.log("CoinGecko API fallback to default rate used:", err));
  }, []);

  // Initiate Payment Flow
  const initiatePayment = (type, agreementAddr, rentVal, depositVal) => {
    const totalEth = Number(ethers.formatEther(rentVal + depositVal));
    const inrVal = Math.round(totalEth * ethToInrRate);
    setPaymentModal({
      show: true,
      type,
      agreementAddr,
      rentVal,
      depositVal,
      step: "select",
      inrAmount: inrVal
    });
  };

  // Simulate Gateway Checkout API
  const handleGatewayPayment = async () => {
    setPaymentModal(prev => ({ ...prev, step: "processing" }));
    
    // Simulate Razorpay / UPI transaction processing
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    setPaymentModal(prev => ({ ...prev, step: "success" }));
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Auto-close gateway and proceed to trigger smart contract transaction
    setPaymentModal(prev => ({ ...prev, show: false }));
    
    if (paymentModal.type === "join") {
      await joinLease(paymentModal.agreementAddr, paymentModal.rentVal, paymentModal.depositVal);
    } else {
      await payRent(paymentModal.agreementAddr, paymentModal.rentVal);
    }
  };

  const switchNetwork = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x539" }] // Hex of 1337
      });
    } catch (err) {
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x539",
                chainName: "Hardhat Localhost",
                nativeCurrency: {
                  name: "Ethereum",
                  symbol: "ETH",
                  decimals: 18
                },
                rpcUrls: ["http://127.0.0.1:8545"]
              }
            ]
          });
        } catch (addErr) {
          console.error(addErr);
        }
      } else {
        console.error(err);
      }
    }
  };

  // Connect Web3 Wallet
  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Web3 Wallet not detected! Please install MetaMask.");
      return;
    }
    try {
      setLoading(true);
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const web3Signer = await web3Provider.getSigner();
      
      const userAccount = accounts[0];
      setAccount(userAccount);
      setSigner(web3Signer);
      setProvider(web3Provider);
      
      // Check network
      const networkData = await web3Provider.getNetwork();
      const chainId = Number(networkData.chainId);
      setNetwork(networkData.name === "unknown" ? `Chain ${chainId}` : networkData.name);
      
      // Support localhost (1337 / 31337) only for local Option A run
      const correct = chainId === 1337 || chainId === 31337;
      setIsCorrectNetwork(correct);

      // Fetch Balance
      const balBigInt = await web3Provider.getBalance(userAccount);
      setBalance(Number(ethers.formatEther(balBigInt)).toFixed(4));
      
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  // Monitor Accounts/Network Changes
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          connectWallet();
        } else {
          setAccount("");
          setSigner(null);
          setBalance("0.0");
        }
      });

      window.ethereum.on("chainChanged", () => {
        window.location.reload();
      });
    }
  }, []);

  // Fetch Agreements
  const fetchAgreements = async () => {
    if (!provider || !account || !isCorrectNetwork) return;
    try {
      setLoading(true);
      const factoryContract = new ethers.Contract(
        CONTRACT_ADDRESSES.RentalAgreementFactory,
        RENTAL_AGREEMENT_FACTORY_ABI,
        provider
      );

      // Get addresses from factory
      const landlordAddrs = await factoryContract.getLandlordAgreements(account);
      const tenantAddrs = await factoryContract.getTenantAgreements(account);

      // Resolve landlord contracts
      const landlordData = await Promise.all(
        landlordAddrs.map(async (addr) => getContractDetails(addr))
      );

      // Resolve tenant contracts
      const tenantData = await Promise.all(
        tenantAddrs.map(async (addr) => getContractDetails(addr))
      );

      setLandlordAgreements(landlordData.filter(d => d !== null));
      setTenantAgreements(tenantData.filter(d => d !== null));
      setLoading(false);
    } catch (err) {
      console.error("Error fetching agreements:", err);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (account) {
      fetchAgreements();
    }
  }, [account, provider, isCorrectNetwork]);

  // Resolve Individual Contract Details
  const getContractDetails = async (address) => {
    try {
      const contract = new ethers.Contract(address, RENTAL_AGREEMENT_ABI, provider);
      
      const [
        landlordAddr,
        tenantAddr,
        rentAmount,
        securityDeposit,
        startTime,
        lastRentPaid,
        duration,
        active,
        propertyAddress,
        documentHash,
        balance
      ] = await Promise.all([
        contract.landlord(),
        contract.tenant(),
        contract.rentAmount(),
        contract.securityDeposit(),
        contract.startTime(),
        contract.lastRentPaid(),
        contract.duration(),
        contract.active(),
        contract.propertyAddress(),
        contract.documentHash(),
        provider.getBalance(address)
      ]);

      return {
        address,
        landlord: landlordAddr,
        tenant: tenantAddr,
        rentAmount,
        securityDeposit,
        startTime: Number(startTime),
        lastRentPaid: Number(lastRentPaid),
        duration: Number(duration),
        active,
        propertyAddress,
        documentHash,
        balance
      };
    } catch (err) {
      console.error(`Error resolving contract at ${address}:`, err);
      return null;
    }
  };

  // Deploy New Agreement
  const createLease = async (e) => {
    e.preventDefault();
    if (!signer) return;

    try {
      showTxFeedback("pending", "Initiating Deployment", "Deploying new Rental Agreement contract to the blockchain...");

      const factoryContract = new ethers.Contract(
        CONTRACT_ADDRESSES.RentalAgreementFactory,
        RENTAL_AGREEMENT_FACTORY_ABI,
        signer
      );

      // Convert INR inputs to ETH strings, then parse to Wei
      const rentEthString = (Number(rent) / ethToInrRate).toFixed(18);
      const depositEthString = (Number(deposit) / ethToInrRate).toFixed(18);

      const rentWei = ethers.parseEther(rentEthString);
      const depositWei = ethers.parseEther(depositEthString);
      const durationDays = BigInt(duration);

      // Estimate Gas for safety
      let gasLimit;
      try {
        gasLimit = await factoryContract.createAgreement.estimateGas(
          rentWei,
          depositWei,
          durationDays,
          propAddr,
          docHash
        );
      } catch (err) {
        console.warn("Gas estimation failed, using default limit", err);
      }

      const tx = await factoryContract.createAgreement(
        rentWei,
        depositWei,
        durationDays,
        propAddr,
        docHash,
        { gasLimit: gasLimit ? (gasLimit * 12n) / 10n : undefined } // 20% buffer
      );

      showTxFeedback("pending", "Transaction Broadcasting", "Transaction submitted. Awaiting block confirmation...", tx.hash);

      const receipt = await tx.wait();
      
      showTxFeedback("success", "Lease Deployed Successfully", "Your decentralized rental agreement has been registered on-chain.", tx.hash);

      // Reset form
      setRent("");
      setDeposit("");
      setDuration("");
      setPropAddr("");
      setDocHash("");

      // Refresh list
      fetchAgreements();
    } catch (err) {
      console.error(err);
      showTxFeedback("error", "Deployment Failed", err.reason || err.message || "An unexpected error occurred.");
    }
  };

  // Join Existing Agreement
  const joinLease = async (agreementAddr, rentVal, depositVal) => {
    if (!signer) return;
    try {
      showTxFeedback("pending", "Joining Agreement", "Sending security deposit and first rent payment to the agreement...");

      const contract = new ethers.Contract(agreementAddr, RENTAL_AGREEMENT_ABI, signer);
      const totalPayment = rentVal + depositVal;

      const tx = await contract.joinAsTenant({
        value: totalPayment
      });

      showTxFeedback("pending", "Transaction Processing", "Confirming deposit on the blockchain...", tx.hash);
      await tx.wait();

      showTxFeedback("success", "Welcome to Your New Home", "You have successfully signed the lease agreement as the tenant.", tx.hash);
      
      fetchAgreements();
      if (exploreDetails && exploreDetails.address === agreementAddr) {
        exploreLease(agreementAddr);
      }
    } catch (err) {
      console.error(err);
      showTxFeedback("error", "Transaction Failed", err.reason || err.message || "Could not join agreement.");
    }
  };

  // Pay Next Rent
  const payRent = async (agreementAddr, rentVal) => {
    if (!signer) return;
    try {
      showTxFeedback("pending", "Processing Rent Payment", "Sending rent payment to the contract ledger...");

      const contract = new ethers.Contract(agreementAddr, RENTAL_AGREEMENT_ABI, signer);

      const tx = await contract.payNextRent({
        value: rentVal
      });

      showTxFeedback("pending", "Transaction Processing", "Awaiting confirmation of rent deposit...", tx.hash);
      await tx.wait();

      showTxFeedback("success", "Rent Paid Successfully", "Your rent payment has been logged on the block registry.", tx.hash);
      
      fetchAgreements();
      if (exploreDetails && exploreDetails.address === agreementAddr) {
        exploreLease(agreementAddr);
      }
    } catch (err) {
      console.error(err);
      showTxFeedback("error", "Transaction Failed", err.reason || err.message || "Could not process rent.");
    }
  };

  // Claim Rent
  const claimRent = async (agreementAddr) => {
    if (!signer) return;
    try {
      showTxFeedback("pending", "Claiming Rent", "Claiming matured rent from the rental agreement contract...");

      const contract = new ethers.Contract(agreementAddr, RENTAL_AGREEMENT_ABI, signer);

      const tx = await contract.claimRent();

      showTxFeedback("pending", "Withdrawing Funds", "Transferring rent balance to your landlord address...", tx.hash);
      await tx.wait();

      showTxFeedback("success", "Rent Claimed", "The monthly rent has been successfully transferred to your wallet.", tx.hash);
      
      fetchAgreements();
      if (exploreDetails && exploreDetails.address === agreementAddr) {
        exploreLease(agreementAddr);
      }
    } catch (err) {
      console.error(err);
      showTxFeedback("error", "Transaction Failed", err.reason || err.message || "Cannot claim rent yet. Check due date!");
    }
  };

  // End Agreement
  const endLease = async (agreementAddr, propertyOk) => {
    if (!signer) return;
    try {
      const actionText = propertyOk ? "Refund Deposit" : "Forfeit Deposit";
      showTxFeedback("pending", `${actionText} & Terminating Lease`, `Closing the lease and executing security deposit: ${actionText}...`);

      const contract = new ethers.Contract(agreementAddr, RENTAL_AGREEMENT_ABI, signer);

      const tx = await contract.endAgreement(propertyOk);

      showTxFeedback("pending", "Settling Balances", "Refunding deposit / transferring forfeit on the blockchain...", tx.hash);
      await tx.wait();

      showTxFeedback("success", "Lease Terminated", `The contract has been deactivated. Deposit action: ${actionText}.`, tx.hash);
      
      fetchAgreements();
      if (exploreDetails && exploreDetails.address === agreementAddr) {
        exploreLease(agreementAddr);
      }
    } catch (err) {
      console.error(err);
      showTxFeedback("error", "Termination Failed", err.reason || err.message || "Could not end lease.");
    }
  };

  // Auto Expire Agreement
  const triggerExpiry = async (agreementAddr) => {
    if (!signer) return;
    try {
      showTxFeedback("pending", "Triggering Lease Expiry", "Deactivating contract and executing automated deposit refund to tenant...");

      const contract = new ethers.Contract(agreementAddr, RENTAL_AGREEMENT_ABI, signer);

      const tx = await contract.autoExpire();

      showTxFeedback("pending", "Refunding Deposit", "Broadcasting refund transaction to block indexers...", tx.hash);
      await tx.wait();

      showTxFeedback("success", "Lease Expired & Refunded", "Lease term completed. Security deposit refunded to tenant address.", tx.hash);
      
      fetchAgreements();
      if (exploreDetails && exploreDetails.address === agreementAddr) {
        exploreLease(agreementAddr);
      }
    } catch (err) {
      console.error(err);
      showTxFeedback("error", "Expiry Action Failed", err.reason || err.message || "Agreement term might not be complete yet.");
    }
  };

  // Explore Specific Agreement
  const exploreLease = async (addr) => {
    setExploreError("");
    setExploreDetails(null);
    if (!ethers.isAddress(addr)) {
      setExploreError("Invalid Ethereum address format.");
      return;
    }
    if (!provider) {
      setExploreError("Please connect wallet first.");
      return;
    }

    try {
      setLoading(true);
      const details = await getContractDetails(addr);
      if (details) {
        setExploreDetails(details);
      } else {
        setExploreError("No active Rental Agreement contract found at this address.");
      }
      setLoading(false);
    } catch (err) {
      setExploreError("Error resolving contract details.");
      setLoading(false);
    }
  };

  // Notification Feedbacks helper
  const showTxFeedback = (state, title, message, txHash = "") => {
    setTxStatus({
      show: true,
      state,
      title,
      message,
      txHash
    });
  };

  const closeTxFeedback = () => {
    setTxStatus(prev => ({ ...prev, show: false }));
  };

  // Helper values
  const getProgressPercentage = (startTime, duration) => {
    if (startTime === 0) return 0;
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - startTime;
    if (elapsed >= duration) return 100;
    return Math.max(0, Math.min(100, Math.floor((elapsed / duration) * 100)));
  };

  const getNextRentDueDate = (lastPaid) => {
    if (lastPaid === 0) return "N/A";
    const nextPay = new Date((lastPaid + 30 * 24 * 60 * 60) * 1000);
    return nextPay.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const formatShortAddress = (addr) => {
    if (!addr) return "";
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  return (
    <div className="app-container">
      {/* Transaction Feedback Modal */}
      {txStatus.show && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <button className="btn-outline" style={{ position: "absolute", top: "10px", right: "10px", padding: "0.25rem 0.5rem" }} onClick={closeTxFeedback}>
              <X size={16} />
            </button>
            <div style={{ padding: "1rem 0" }}>
              {txStatus.state === "pending" && <div className="spinner"></div>}
              {txStatus.state === "success" && (
                <div className="icon-circle icon-success">
                  <CheckCircle size={36} />
                </div>
              )}
              {txStatus.state === "error" && (
                <div className="icon-circle icon-error">
                  <AlertTriangle size={36} />
                </div>
              )}

              <h3 style={{ margin: "1rem 0 0.5rem 0" }}>{txStatus.title}</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 1.5rem 0" }}>{txStatus.message}</p>
              
              {txStatus.txHash && (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", background: "rgba(0,0,0,0.3)", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.8rem", marginBottom: "1rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Tx:</span>
                  <span style={{ fontFamily: "monospace" }}>{formatShortAddress(txStatus.txHash)}</span>
                  {/* Hardhat doesn't have an explorer, but Sepolia/Localhost could link to Sepolia Etherscan */}
                  <a href={`https://sepolia.etherscan.io/tx/${txStatus.txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-cyan)", display: "flex", alignItems: "center" }}>
                    <ExternalLink size={14} />
                  </a>
                </div>
              )}

              {txStatus.state !== "pending" && (
                <button className="btn-primary" onClick={closeTxFeedback} style={{ width: "100%" }}>
                  Close Window
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* INR / Payment Gateway Modal */}
      {paymentModal.show && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ maxWidth: "420px", padding: "1.5rem", borderTop: "3px solid #3399cc" }}>
            <button className="btn-outline" style={{ position: "absolute", top: "10px", right: "10px", padding: "0.25rem 0.5rem" }} onClick={() => setPaymentModal(prev => ({ ...prev, show: false }))}>
              <X size={16} />
            </button>
            
            <div style={{ textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                <Shield size={20} style={{ color: "#3399cc" }} />
                <span style={{ fontWeight: 600, fontSize: "1.1rem", fontFamily: "Space Grotesk" }}>RentSphere checkout</span>
              </div>

              {paymentModal.step === "select" && (
                <div>
                  <h4 style={{ margin: "0 0 1rem 0" }}>Choose Payment Method</h4>
                  <div style={{ background: "rgba(0,0,0,0.15)", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
                      <span style={{ color: "var(--text-muted)" }}>Total Crypto Value:</span>
                      <span style={{ fontWeight: 600 }}>
                        {ethers.formatEther(paymentModal.rentVal + paymentModal.depositVal)} ETH
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border-color)", paddingTop: "0.5rem" }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>INR Equivalent:</span>
                      <span style={{ fontWeight: 700, color: "var(--accent-cyan)", fontSize: "1.1rem" }}>
                        ₹{paymentModal.inrAmount.toLocaleString("en-IN")}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem", textAlign: "right" }}>
                      Rate: 1 ETH = ₹{Math.round(ethToInrRate).toLocaleString("en-IN")}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <button className="btn-primary" style={{ width: "100%", justifyContent: "center", background: "linear-gradient(135deg, #00f2fe, #4facfe)" }} onClick={handleGatewayPayment}>
                      <DollarSign size={18} />
                      Pay via UPI / INR Gateway (Razorpay)
                    </button>
                    <button className="btn-outline" style={{ width: "100%", justifyContent: "center" }} onClick={async () => {
                      setPaymentModal(prev => ({ ...prev, show: false }));
                      if (paymentModal.type === "join") {
                        await joinLease(paymentModal.agreementAddr, paymentModal.rentVal, paymentModal.depositVal);
                      } else {
                        await payRent(paymentModal.agreementAddr, paymentModal.rentVal);
                      }
                    }}>
                      <Wallet size={18} />
                      Pay via Web3 Wallet (ETH)
                    </button>
                  </div>
                </div>
              )}

              {paymentModal.step === "processing" && (
                <div style={{ textAlign: "center", padding: "2rem 0" }}>
                  <div className="spinner" style={{ borderTopColor: "#3399cc", borderBottomColor: "#3399cc" }}></div>
                  <h4 style={{ margin: "1.5rem 0 0.5rem 0" }}>Processing INR Payment</h4>
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: 0 }}>
                    Please complete UPI push payment on your mobile device...
                  </p>
                </div>
              )}

              {paymentModal.step === "success" && (
                <div style={{ textAlign: "center", padding: "2rem 0" }}>
                  <div className="icon-circle icon-success" style={{ color: "#3399cc", borderColor: "#3399cc", boxShadow: "0 0 15px rgba(51,153,204,0.2)" }}>
                    <CheckCircle size={36} />
                  </div>
                  <h4 style={{ margin: "1.5rem 0 0.5rem 0" }}>INR Payment Successful</h4>
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: 0 }}>
                    Broadcasting lease signatures to the smart contract...
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Network Alert Banner */}
      {!isCorrectNetwork && account && (
        <div style={{ background: "rgba(244, 63, 94, 0.15)", border: "1px solid var(--accent-rose)", borderRadius: "12px", padding: "1rem", marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--accent-rose)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <AlertTriangle size={24} />
            <div>
              <div style={{ fontWeight: 600, fontFamily: "Space Grotesk" }}>Incorrect Network Connected ({network})</div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Please switch your wallet provider to Hardhat Localhost (Chain ID: 1337) to transact on this platform.
              </div>
            </div>
          </div>
          <button className="btn-primary" onClick={switchNetwork} style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", border: "none" }}>
            Switch to Localhost
          </button>
        </div>
      )}

      {/* Header */}
      <header className="app-header glass-panel">
        <div className="brand">
          <Shield size={28} style={{ color: "var(--accent-cyan)" }} />
          <span>RentSphere</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {account ? (
            <div className="tab-bar">
              <button className={`tab-btn ${activeTab === "landlord" ? "active" : ""}`} onClick={() => setActiveTab("landlord")}>
                Landlord Panel
              </button>
              <button className={`tab-btn ${activeTab === "tenant" ? "active" : ""}`} onClick={() => setActiveTab("tenant")}>
                Tenant Panel
              </button>
              <button className={`tab-btn ${activeTab === "explore" ? "active" : ""}`} onClick={() => setActiveTab("explore")}>
                Explore Contracts
              </button>
              <button className={`tab-btn ${activeTab === "enterprise" ? "active" : ""}`} onClick={() => setActiveTab("enterprise")}>
                Enterprise SaaS
              </button>
            </div>
          ) : null}

          {account ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", padding: "0.5rem 1rem", borderRadius: "12px" }}>
              <div style={{ width: "8px", height: "8px", background: "var(--accent-emerald)", borderRadius: "50%" }}></div>
              <span style={{ fontSize: "0.85rem", fontWeight: 500, fontFamily: "monospace" }}>{formatShortAddress(account)}</span>
              <span style={{ fontSize: "0.85rem", color: "var(--accent-cyan)", borderLeft: "1px solid var(--border-color)", paddingLeft: "0.75rem" }}>{balance} ETH</span>
            </div>
          ) : (
            <button className="btn-primary" onClick={connectWallet} disabled={loading}>
              <Wallet size={18} />
              {loading ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      {/* Main Landing / Connect Wallet State */}
      {!account ? (
        <main className="glass-panel" style={{ padding: "4rem 2rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem" }}>
          <div style={{ background: "linear-gradient(135deg, rgba(0,242,254,0.1), rgba(155,81,224,0.1))", border: "1px solid var(--border-glow)", borderRadius: "50%", padding: "2rem", color: "var(--accent-cyan)" }}>
            <Building size={64} />
          </div>
          <h1 style={{ fontSize: "2.5rem", margin: 0, background: "linear-gradient(135deg, #fff, #94a3b8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Decentralized Smart Leases
          </h1>
          <p style={{ maxWidth: "580px", color: "var(--text-secondary)", margin: 0 }}>
            Sign, deploy, pay, and settle lease agreements securely using zero-trusted, cryptographically enforced smart contracts. Protect your security deposit trustlessly.
          </p>
          <button className="btn-primary" onClick={connectWallet} style={{ fontSize: "1.1rem", padding: "1rem 2rem", marginTop: "1rem" }}>
            <Wallet size={20} />
            Connect Web3 Wallet
          </button>
        </main>
      ) : (
        <main>
          {/* Stats Bar */}
          <div className="stats-banner">
            <div className="stat-box glass-panel">
              <div className="stat-icon">
                <Building size={20} />
              </div>
              <div className="stat-info">
                <span className="stat-label">Landlord Leases</span>
                <span className="stat-number">{landlordAgreements.length}</span>
              </div>
            </div>

            <div className="stat-box glass-panel">
              <div className="stat-icon" style={{ color: "var(--accent-purple)" }}>
                <User size={20} />
              </div>
              <div className="stat-info">
                <span className="stat-label">Tenant Leases</span>
                <span className="stat-number">{tenantAgreements.length}</span>
              </div>
            </div>

            <div className="stat-box glass-panel">
              <div className="stat-icon" style={{ color: "var(--accent-emerald)" }}>
                <DollarSign size={20} />
              </div>
              <div className="stat-info">
                <span className="stat-label">Rent Volume</span>
                <span className="stat-number">
                  {Number(
                    ethers.formatEther(
                      [...landlordAgreements, ...tenantAgreements].reduce(
                        (acc, curr) => acc + curr.rentAmount,
                        0n
                      )
                    )
                  ).toFixed(2)}{" "}
                  ETH
                </span>
              </div>
            </div>

            <div className="stat-box glass-panel">
              <div className="stat-icon" style={{ color: "var(--accent-amber)" }}>
                <Calendar size={20} />
              </div>
              <div className="stat-info">
                <span className="stat-label">System Node</span>
                <span className="stat-number" style={{ fontSize: "1rem", color: "var(--text-secondary)", paddingTop: "0.25rem" }}>
                  {network}
                </span>
              </div>
            </div>
          </div>

          {/* TAB 1: LANDLORD PANEL */}
          {activeTab === "landlord" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem", alignItems: "start" }}>
              {/* Deploy Contract Form */}
              <div className="glass-panel" style={{ padding: "1.5rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Plus size={20} style={{ color: "var(--accent-cyan)" }} />
                  Deploy New Smart Lease
                </h3>
                <form onSubmit={createLease}>
                  <div className="form-group">
                    <label className="form-label">Property Address</label>
                    <input className="form-input" required type="text" placeholder="e.g. 742 Evergreen Terrace, Springfield" value={propAddr} onChange={(e) => setPropAddr(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Monthly Rent (INR)</label>
                    <input className="form-input" required type="number" min="0" placeholder="e.g. 15000" value={rent} onChange={(e) => setRent(e.target.value)} />
                    {rent && (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Estimated Chain Cost: {(Number(rent) / ethToInrRate).toFixed(4)} ETH
                      </span>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Security Deposit (INR)</label>
                    <input className="form-input" required type="number" min="0" placeholder="e.g. 30000" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
                    {deposit && (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Estimated Chain Cost: {(Number(deposit) / ethToInrRate).toFixed(4)} ETH
                      </span>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Lease Duration (Days)</label>
                    <input className="form-input" required type="number" min="1" placeholder="e.g. 30" value={duration} onChange={(e) => setDuration(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">IPFS Lease Agreement / PDF link</label>
                    <input className="form-input" required type="text" placeholder="e.g. QmYwAPJzv5CZ1gtjT3y..." value={docHash} onChange={(e) => setDocHash(e.target.value)} />
                  </div>

                  <button className="btn-primary" type="submit" style={{ width: "100%", justifyContent: "center", marginTop: "1rem" }} disabled={!isCorrectNetwork}>
                    Deploy Lease Contract
                  </button>
                </form>
              </div>

              {/* Deployed Leases List */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>My Listed Properties</h3>
                  <button className="btn-outline" style={{ padding: "0.4rem 0.75rem", fontSize: "0.85rem" }} onClick={fetchAgreements} disabled={loading}>
                    <RefreshCw size={14} className={loading ? "spin" : ""} />
                    Refresh
                  </button>
                </div>

                {landlordAgreements.length === 0 ? (
                  <div className="glass-panel" style={{ padding: "4rem 2rem", textAlign: "center", marginTop: "1rem", color: "var(--text-secondary)" }}>
                    <Building size={48} style={{ opacity: 0.3, marginBottom: "1rem" }} />
                    <p>No active rental agreements found. Use the deploy form on the left to list your first smart lease!</p>
                  </div>
                ) : (
                  <div className="dashboard-grid">
                    {landlordAgreements.map((agreement) => {
                      const now = Math.floor(Date.now() / 1000);
                      const isExpired = agreement.startTime > 0 && now >= agreement.startTime + agreement.duration;
                      const canClaim = agreement.active && now >= agreement.lastRentPaid + 30 * 24 * 60 * 60;
                      
                      return (
                        <div key={agreement.address} className="glass-panel agreement-card">
                          <div className="card-header">
                            <div>
                              <h4 className="card-title">{agreement.propertyAddress || "Unnamed Property"}</h4>
                              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{formatShortAddress(agreement.address)}</span>
                            </div>
                            <span className={`status-badge ${agreement.active ? "status-active" : (agreement.tenant === ethers.ZeroAddress ? "status-pending" : "status-closed")}`}>
                              {agreement.active && <span className="pulse-dot"></span>}
                              {agreement.active ? "Active" : (agreement.tenant === ethers.ZeroAddress ? "Awaiting Tenant" : "Terminated")}
                            </span>
                          </div>

                          <div className="card-body">
                            <div className="info-item">
                              <span className="info-label">Rent Amount</span>
                              <span className="info-val">{ethers.formatEther(agreement.rentAmount)} ETH</span>
                            </div>
                            <div className="info-item">
                              <span className="info-label">Deposit</span>
                              <span className="info-val">{ethers.formatEther(agreement.securityDeposit)} ETH</span>
                            </div>
                            <div className="info-item">
                              <span className="info-label">Tenant Address</span>
                              <span className="info-val address-val">
                                {agreement.tenant !== ethers.ZeroAddress ? formatShortAddress(agreement.tenant) : "None yet"}
                              </span>
                            </div>
                            <div className="info-item">
                              <span className="info-label">Vault Balance</span>
                              <span className="info-val" style={{ color: "var(--accent-cyan)" }}>{ethers.formatEther(agreement.balance)} ETH</span>
                            </div>
                          </div>

                          {agreement.tenant !== ethers.ZeroAddress && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", background: "rgba(0,0,0,0.15)", padding: "0.75rem", borderRadius: "8px", fontSize: "0.85rem" }}>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-muted)" }}>Next Rent Claim:</span>
                                <span style={{ color: canClaim ? "var(--accent-emerald)" : "var(--text-secondary)", fontWeight: 600 }}>
                                  {canClaim ? "Claim Available!" : getNextRentDueDate(agreement.lastRentPaid)}
                                </span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-muted)" }}>Lease Expiry:</span>
                                <span>{new Date((agreement.startTime + agreement.duration) * 1000).toLocaleDateString()}</span>
                              </div>
                            </div>
                          )}

                          <div className="card-actions">
                            {agreement.active ? (
                              <>
                                <button className="btn-primary" style={{ flex: 1, fontSize: "0.85rem" }} onClick={() => claimRent(agreement.address)} disabled={!canClaim}>
                                  Claim Rent
                                </button>
                                <button className="btn-outline" style={{ flex: 1, fontSize: "0.85rem", borderColor: "rgba(244, 63, 94, 0.3)", color: "var(--accent-rose)" }} onClick={() => endLease(agreement.address, true)}>
                                  End Lease
                                </button>
                              </>
                            ) : agreement.tenant !== ethers.ZeroAddress ? (
                              <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", width: "100%" }}>Lease Closed</span>
                            ) : (
                              <button className="btn-outline" style={{ width: "100%", fontSize: "0.85rem" }} onClick={() => {
                                navigator.clipboard.writeText(agreement.address);
                                alert("Contract address copied!");
                              }}>
                                Copy Address to Share
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: TENANT PANEL */}
          {activeTab === "tenant" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem", alignItems: "start" }}>
              {/* Join Lease Widget */}
              <div className="glass-panel" style={{ padding: "1.5rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Plus size={20} style={{ color: "var(--accent-purple)" }} />
                  Sign Active Smart Lease
                </h3>
                <div className="form-group">
                  <label className="form-label">Rental Agreement Contract Address</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input className="form-input" type="text" placeholder="0x..." value={exploreAddress} onChange={(e) => setExploreAddress(e.target.value)} />
                    <button className="btn-outline" style={{ padding: "0.5rem 1rem" }} onClick={() => exploreLease(exploreAddress)}>
                      <Search size={16} />
                    </button>
                  </div>
                </div>

                {exploreError && <div style={{ color: "var(--accent-rose)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{exploreError}</div>}

                {exploreDetails && (
                  <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border-color)", paddingTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600 }}>{exploreDetails.propertyAddress}</span>
                      <span className={`status-badge ${exploreDetails.active ? "status-active" : (exploreDetails.tenant === ethers.ZeroAddress ? "status-pending" : "status-closed")}`}>
                        {exploreDetails.active ? "Active" : (exploreDetails.tenant === ethers.ZeroAddress ? "Awaiting Tenant" : "Closed")}
                      </span>
                    </div>

                    <div style={{ background: "rgba(0,0,0,0.15)", padding: "0.75rem", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-muted)" }}>Monthly Rent:</span>
                        <span>{ethers.formatEther(exploreDetails.rentAmount)} ETH</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-muted)" }}>Deposit Required:</span>
                        <span>{ethers.formatEther(exploreDetails.securityDeposit)} ETH</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-muted)" }}>Total Due Now:</span>
                        <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                          {ethers.formatEther(exploreDetails.rentAmount + exploreDetails.securityDeposit)} ETH
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-muted)" }}>Landlord:</span>
                        <span style={{ fontFamily: "monospace" }}>{formatShortAddress(exploreDetails.landlord)}</span>
                      </div>
                    </div>

                    {exploreDetails.tenant === ethers.ZeroAddress ? (
                      <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => initiatePayment("join", exploreDetails.address, exploreDetails.rentAmount, exploreDetails.securityDeposit)}>
                        Sign Lease & Deposit Funds
                      </button>
                    ) : exploreDetails.tenant === account ? (
                      <div style={{ color: "var(--accent-emerald)", fontSize: "0.85rem", textAlign: "center" }}>
                        You are already the tenant of this lease.
                      </div>
                    ) : (
                      <div style={{ color: "var(--accent-rose)", fontSize: "0.85rem", textAlign: "center" }}>
                        Lease already rented by another tenant ({formatShortAddress(exploreDetails.tenant)}).
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Rented Leases List */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>My Active Leases</h3>
                  <button className="btn-outline" style={{ padding: "0.4rem 0.75rem", fontSize: "0.85rem" }} onClick={fetchAgreements} disabled={loading}>
                    <RefreshCw size={14} className={loading ? "spin" : ""} />
                    Refresh
                  </button>
                </div>

                {tenantAgreements.length === 0 ? (
                  <div className="glass-panel" style={{ padding: "4rem 2rem", textAlign: "center", marginTop: "1rem", color: "var(--text-secondary)" }}>
                    <User size={48} style={{ opacity: 0.3, marginBottom: "1rem" }} />
                    <p>You have not signed any active leases. Enter a lease contract address on the left to sign one!</p>
                  </div>
                ) : (
                  <div className="dashboard-grid">
                    {tenantAgreements.map((agreement) => {
                      const now = Math.floor(Date.now() / 1000);
                      const isExpired = agreement.startTime > 0 && now >= agreement.startTime + agreement.duration;
                      const nextDue = agreement.lastRentPaid + 30 * 24 * 60 * 60;
                      const daysLeft = Math.ceil((nextDue - now) / (24 * 60 * 60));
                      const progress = getProgressPercentage(agreement.startTime, agreement.duration);

                      return (
                        <div key={agreement.address} className="glass-panel agreement-card">
                          <div className="card-header">
                            <div>
                              <h4 className="card-title">{agreement.propertyAddress || "Unnamed Property"}</h4>
                              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{formatShortAddress(agreement.address)}</span>
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
                              <span className="info-label">Landlord Address</span>
                              <span className="info-val address-val">{formatShortAddress(agreement.landlord)}</span>
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
                                {daysLeft <= 0 ? "Immediate Payment Due" : `in ${daysLeft} days`}
                              </span>
                            </div>
                            {/* Lease Completion Progress Bar */}
                            <div style={{ marginTop: "0.25rem" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                                <span>Lease progress</span>
                                <span>{progress}%</span>
                              </div>
                              <div style={{ height: "4px", background: "rgba(255, 255, 255, 0.05)", borderRadius: "2px", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, var(--accent-cyan), var(--accent-purple))", borderRadius: "2px" }}></div>
                              </div>
                            </div>
                          </div>

                          <div className="card-actions">
                            {agreement.active ? (
                              <>
                                <button className="btn-primary" style={{ flex: 1, fontSize: "0.85rem" }} onClick={() => initiatePayment("pay", agreement.address, agreement.rentAmount, 0n)}>
                                  Pay Rent
                                </button>
                                {isExpired && (
                                  <button className="btn-outline" style={{ flex: 1, fontSize: "0.85rem", borderColor: "var(--accent-amber)", color: "var(--accent-amber)" }} onClick={() => triggerExpiry(agreement.address)}>
                                    Trigger Expiry
                                  </button>
                                )}
                              </>
                            ) : (
                              <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", width: "100%" }}>Lease Closed</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: EXPLORE / SEARCH PANEL */}
          {activeTab === "explore" && (
            <div style={{ maxWidth: "680px", margin: "0 auto" }}>
              <div className="glass-panel" style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                <h3 style={{ margin: 0, textAlign: "center" }}>Search On-Chain Leases</h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", textAlign: "center", margin: 0 }}>
                  Retrieve contract terms, verify lease legitimacy, check rent ledgers, or examine safety deposits of any verified RentSphere contract.
                </p>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input className="form-input" style={{ fontSize: "1.1rem" }} type="text" placeholder="Paste Lease Contract Address (0x...)" value={exploreAddress} onChange={(e) => setExploreAddress(e.target.value)} />
                    <button className="btn-primary" style={{ padding: "0.75rem 1.5rem" }} onClick={() => exploreLease(exploreAddress)}>
                      <Search size={20} />
                    </button>
                  </div>
                </div>

                {exploreError && <div style={{ color: "var(--accent-rose)", textAlign: "center", fontSize: "0.9rem" }}>{exploreError}</div>}

                {exploreDetails && (
                  <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h4 style={{ margin: 0, fontSize: "1.3rem" }}>{exploreDetails.propertyAddress}</h4>
                      <span className={`status-badge ${exploreDetails.active ? "status-active" : (exploreDetails.tenant === ethers.ZeroAddress ? "status-pending" : "status-closed")}`}>
                        {exploreDetails.active ? "Active" : (exploreDetails.tenant === ethers.ZeroAddress ? "Awaiting Tenant" : "Closed")}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", background: "rgba(0,0,0,0.15)", padding: "1rem", borderRadius: "10px", fontSize: "0.9rem" }}>
                      <div className="info-item">
                        <span className="info-label">Rent Amount</span>
                        <span className="info-val">{ethers.formatEther(exploreDetails.rentAmount)} ETH</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Security Deposit</span>
                        <span className="info-val">{ethers.formatEther(exploreDetails.securityDeposit)} ETH</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Landlord Address</span>
                        <span className="info-val address-val">{formatShortAddress(exploreDetails.landlord)}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Tenant Address</span>
                        <span className="info-val address-val">
                          {exploreDetails.tenant !== ethers.ZeroAddress ? formatShortAddress(exploreDetails.tenant) : "No Tenant Registered"}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Lease Duration</span>
                        <span className="info-val">{Math.round(exploreDetails.duration / (24 * 60 * 60))} Days</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Vault Balance</span>
                        <span className="info-val" style={{ color: "var(--accent-cyan)" }}>{ethers.formatEther(exploreDetails.balance)} ETH</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", padding: "0.75rem 1rem", borderRadius: "8px", fontSize: "0.85rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <FileText size={16} style={{ color: "var(--accent-cyan)" }} />
                        <span style={{ fontWeight: 600 }}>Lease Agreement Document Hash:</span>
                      </div>
                      <div style={{ fontFamily: "monospace", wordBreak: "break-all", background: "rgba(0,0,0,0.2)", padding: "0.5rem", borderRadius: "4px", color: "var(--text-secondary)" }}>
                        {exploreDetails.documentHash}
                      </div>
                    </div>

                    {/* Conditional action buttons depending on explorer's identity */}
                    {exploreDetails.tenant === ethers.ZeroAddress && exploreDetails.landlord !== account && (
                      <button className="btn-primary" style={{ justifyContent: "center" }} onClick={() => initiatePayment("join", exploreDetails.address, exploreDetails.rentAmount, exploreDetails.securityDeposit)}>
                        Sign Lease Contract & Pay ₹{Math.round(Number(ethers.formatEther(exploreDetails.rentAmount + exploreDetails.securityDeposit)) * ethToInrRate).toLocaleString("en-IN")}
                      </button>
                    )}

                    {exploreDetails.tenant === account && exploreDetails.active && (
                      <button className="btn-primary" style={{ justifyContent: "center" }} onClick={() => initiatePayment("pay", exploreDetails.address, exploreDetails.rentAmount, 0n)}>
                        Pay Next Rent (₹{Math.round(Number(ethers.formatEther(exploreDetails.rentAmount)) * ethToInrRate).toLocaleString("en-IN")})
                      </button>
                    )}

                    {exploreDetails.landlord === account && exploreDetails.active && (
                      <div style={{ display: "flex", gap: "0.75rem" }}>
                        <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => claimRent(exploreDetails.address)}>
                          Claim Rent
                        </button>
                        <button className="btn-outline" style={{ flex: 1, justifyContent: "center", borderColor: "var(--accent-rose)", color: "var(--accent-rose)" }} onClick={() => endLease(exploreDetails.address, true)}>
                          Terminate Lease
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: ENTERPRISE SaaS PORTAL */}
          {activeTab === "enterprise" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem", alignItems: "start" }}>
              
              {/* Left Column: SaaS Org & Role Selector & Live APIs */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                <div className="glass-panel" style={{ padding: "1.5rem" }}>
                  <h3 style={{ marginTop: 0, marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <Shield size={20} style={{ color: "var(--accent-purple)" }} />
                    SaaS Configuration
                  </h3>

                  <div className="form-group">
                    <label className="form-label">SaaS Organization Tenant</label>
                    <select className="form-input" value={saasOrg} onChange={(e) => setSaasOrg(e.target.value)}>
                      <option value="DLF Limited">DLF Limited</option>
                      <option value="Tata Housing">Tata Housing</option>
                      <option value="Lodha Group">Lodha Group</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Active Role Profile (RBAC)</label>
                    <select className="form-input" value={saasRole} onChange={(e) => setSaasRole(e.target.value)}>
                      <option value="Super Admin">Super Admin (Analytics & Controls)</option>
                      <option value="Legal Officer">Legal Officer (Integrity Verifications)</option>
                      <option value="Auditor">Auditor (Security Logs Audit)</option>
                      <option value="Property Owner">Property Owner (Landlord Dashboard)</option>
                      <option value="Tenant">Tenant (Rent/Sign Panel)</option>
                    </select>
                  </div>
                </div>

                {/* API Request Logs Console (Terminal Style) */}
                <div className="glass-panel" style={{ padding: "1.5rem", background: "#06090f", border: "1px solid rgba(0,242,254,0.1)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "monospace" }}>REST API Gateway Logs</span>
                    <span style={{ width: "8px", height: "8px", background: "var(--accent-emerald)", borderRadius: "50%" }}></span>
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "250px", overflowY: "auto", textAlign: "left" }}>
                    {apiLogs.map((log, i) => (
                      <div key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", paddingBottom: "0.25rem" }}>
                        <span style={{ color: "var(--text-muted)" }}>[{log.timestamp}]</span>{" "}
                        <span style={{ color: log.method === "POST" ? "var(--accent-cyan)" : (log.method === "GET" ? "var(--accent-purple)" : "var(--accent-amber)"), fontWeight: "bold" }}>
                          {log.method}
                        </span>{" "}
                        <span style={{ color: "var(--text-primary)" }}>{log.endpoint}</span>{" "}
                        <span style={{ color: log.status.includes("200") ? "var(--accent-emerald)" : "var(--accent-rose)" }}>
                          ({log.status})
                        </span>
                        {log.details && <div style={{ color: "var(--text-muted)", marginLeft: "1rem", fontStyle: "italic" }}>↳ {log.details}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Contextual Interfaces based on Role */}
              <div className="glass-panel" style={{ padding: "2rem" }}>
                
                {/* 1. Super Admin View */}
                {saasRole === "Super Admin" && (
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: "1.5rem" }}>Super Admin SaaS Analytics - {saasOrg}</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
                      <div style={{ background: "rgba(255,255,255,0.02)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>Tenant Org ID</div>
                        <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--accent-purple)", fontFamily: "Space Grotesk" }}>{saasOrg.toLowerCase().replace(" ", "_")}</div>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.02)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>Active Users (Verified)</div>
                        <div style={{ fontSize: "1.2rem", fontWeight: "bold", fontFamily: "Space Grotesk" }}>14 Users</div>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.02)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>API Key State</div>
                        <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "var(--accent-emerald)", fontFamily: "Space Grotesk" }}>ACTIVE (Auto-Scale)</div>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.02)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>System Uptime</div>
                        <div style={{ fontSize: "1.2rem", fontWeight: "bold", fontFamily: "Space Grotesk" }}>99.98%</div>
                      </div>
                    </div>
                    <div style={{ background: "rgba(0,242,254,0.03)", border: "1px dashed var(--accent-cyan)", padding: "1rem", borderRadius: "8px", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                      <strong>Admin Console Alert:</strong> Data isolation controls (Row-Level Security) are actively partitionining {saasOrg} tables. System is currently serving multiple landlords completely isolated on-chain via deployment parameters.
                    </div>
                  </div>
                )}

                {/* 2. Legal Officer View (Hash Integrity Verifier) */}
                {saasRole === "Legal Officer" && (
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: "1rem" }}>Legal Officer - Document Integrity Verifier</h3>
                    <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                      Validate the cryptographic authenticity of a physical lease contract. The off-chain PDF's SHA256 hash will be verified against the block registry.
                    </p>

                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Agreement Address / ID</label>
                        <input className="form-input" type="text" placeholder="e.g. agreement_001" value={integrityAddress} onChange={(e) => setIntegrityAddress(e.target.value)} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Physical PDF File SHA256 Hash</label>
                        <input className="form-input" type="text" placeholder="e.g. a2b585dd299e03d12FA..." value={integrityHash} onChange={(e) => setIntegrityHash(e.target.value)} />
                      </div>
                      <button className="btn-primary" style={{ justifyContent: "center" }} onClick={verifyDocIntegrity}>
                        Run Verification Engine
                      </button>
                    </div>

                    {integrityResult && (
                      <div style={{ background: integrityResult.isValid ? "rgba(16,185,129,0.08)" : "rgba(244,63,94,0.08)", border: `1px solid ${integrityResult.isValid ? "var(--accent-emerald)" : "var(--accent-rose)"}`, padding: "1rem", borderRadius: "8px", fontSize: "0.85rem" }}>
                        <div style={{ fontWeight: 600, fontSize: "1rem", color: integrityResult.isValid ? "var(--accent-emerald)" : "var(--accent-rose)", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                          {integrityResult.isValid ? "VALIDITY PASSED" : "VALIDITY FAILED"}
                        </div>
                        <div style={{ wordBreak: "break-all", marginBottom: "0.25rem" }}><span style={{ color: "var(--text-muted)" }}>On-Chain Hash:</span> {integrityResult.onChainHash}</div>
                        <div style={{ wordBreak: "break-all" }}><span style={{ color: "var(--text-muted)" }}>Provided Hash:</span> {integrityResult.providedHash}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Auditor View (Audit Trail logs) */}
                {saasRole === "Auditor" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                      <h3 style={{ margin: 0 }}>Auditor - Security Logs Audit Trail</h3>
                      <button className="btn-outline" style={{ padding: "0.4rem 0.75rem", fontSize: "0.85rem" }} onClick={() => fetchAuditLogs()}>
                        <RefreshCw size={14} /> Refresh
                      </button>
                    </div>
                    
                    {remoteAuditLogs.length === 0 ? (
                      <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--text-secondary)" }}>
                        No audit trails recorded yet. Initiate transactions to log events.
                      </div>
                    ) : (
                      <div style={{ maxHeight: "400px", overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", textAlign: "left" }}>
                          <thead>
                            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--border-color)" }}>
                              <th style={{ padding: "0.75rem" }}>Timestamp</th>
                              <th style={{ padding: "0.75rem" }}>Event Action</th>
                              <th style={{ padding: "0.75rem" }}>Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            {remoteAuditLogs.map((log) => (
                              <tr key={log.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                                <td style={{ padding: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                                  {new Date(log.timestamp).toLocaleTimeString()}
                                </td>
                                <td style={{ padding: "0.75rem" }}>
                                  <span style={{ color: log.action.includes("ALERT") ? "var(--accent-rose)" : "var(--accent-cyan)", fontWeight: 600 }}>
                                    {log.action}
                                  </span>
                                </td>
                                <td style={{ padding: "0.75rem", color: "var(--text-secondary)" }}>{log.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Other Roles Notification info */}
                {(saasRole === "Property Owner" || saasRole === "Tenant") && (
                  <div style={{ textAlign: "center", padding: "2rem 0" }}>
                    <Shield size={48} style={{ color: "var(--accent-cyan)", opacity: 0.5, marginBottom: "1rem" }} />
                    <h4>Interface redirected</h4>
                    <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", maxWidth: "420px", margin: "0 auto" }}>
                      This profile uses the main **Landlord Panel** and **Tenant Panel** tabs at the top for primary business operations (signing agreements, paying rent, and launching local MetaMask checkouts).
                    </p>
                  </div>
                )}

                {/* Developer APIs Showcase (Swagger style) */}
                <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border-color)" }}>
                  <h4 style={{ margin: "0 0 1rem 0", fontFamily: "Space Grotesk", color: "var(--text-muted)" }}>Swagger REST endpoints Documentation</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.8rem", fontFamily: "monospace" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(16,185,129,0.05)", padding: "0.5rem", borderRadius: "4px", border: "1px solid rgba(16,185,129,0.1)" }}>
                      <span style={{ color: "var(--accent-emerald)", fontWeight: 600 }}>POST</span>
                      <span>/api/agreements</span>
                      <span style={{ color: "var(--text-muted)" }}>Creates PDF Draft</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,242,254,0.05)", padding: "0.5rem", borderRadius: "4px", border: "1px solid rgba(0,242,254,0.1)" }}>
                      <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>GET</span>
                      <span>/api/agreements/:id</span>
                      <span style={{ color: "var(--text-muted)" }}>Fetches Meta details</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(16,185,129,0.05)", padding: "0.5rem", borderRadius: "4px", border: "1px solid rgba(16,185,129,0.1)" }}>
                      <span style={{ color: "var(--accent-emerald)", fontWeight: 600 }}>POST</span>
                      <span>/api/payments</span>
                      <span style={{ color: "var(--text-muted)" }}>Logs INR Transactions</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(155,81,224,0.05)", padding: "0.5rem", borderRadius: "4px", border: "1px solid rgba(155,81,224,0.1)" }}>
                      <span style={{ color: "var(--accent-purple)", fontWeight: 600 }}>POST</span>
                      <span>/api/verifyAgreement</span>
                      <span style={{ color: "var(--text-muted)" }}>Checks SHA256 Integrity</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

export default App;
