import { ethers } from "ethers";
import { RENTAL_AGREEMENT_FACTORY_ABI, RENTAL_AGREEMENT_ABI } from "../contracts/abis.js";
import { CONTRACT_ADDRESSES } from "../contracts/contractAddress.js";

const DEFAULT_FACTORY_ADDRESS = CONTRACT_ADDRESSES.RentalAgreementFactory;

/**
 * Connects to MetaMask and retrieves provider, signer, account, balance, and chainId.
 */
export async function connectWeb3() {
  if (!window.ethereum) {
    throw new Error("No Ethereum wallet found. Please install MetaMask to interact with on-chain leases.");
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await provider.send("eth_requestAccounts", []);
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts authorized in wallet.");
  }

  const signer = await provider.getSigner();
  const account = accounts[0];
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const balBigInt = await provider.getBalance(account);
  const balance = Number(ethers.formatEther(balBigInt)).toFixed(4);

  // Consider localhost (1337 or 31337) or Sepolia (11155111) as valid
  const isCorrectNetwork = chainId === 1337 || chainId === 31337 || chainId === 11155111;

  return {
    provider,
    signer,
    account,
    balance,
    chainId,
    networkName: network.name === "unknown" ? `Chain ${chainId}` : network.name,
    isCorrectNetwork
  };
}

/**
 * Requests the wallet to switch to Hardhat Localhost (1337).
 */
export async function switchToLocalhost() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x539" }] // 1337 in hex
    });
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x539",
            chainName: "Hardhat Localhost",
            nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
            rpcUrls: ["http://127.0.0.1:8545"]
          }
        ]
      });
    } else {
      throw err;
    }
  }
}

/**
 * Returns a RentalAgreementFactory contract instance.
 */
export function getFactoryContract(signerOrProvider, factoryAddress = DEFAULT_FACTORY_ADDRESS) {
  return new ethers.Contract(factoryAddress, RENTAL_AGREEMENT_FACTORY_ABI, signerOrProvider);
}

/**
 * Returns a RentalAgreement contract instance.
 */
export function getAgreementContract(address, signerOrProvider) {
  return new ethers.Contract(address, RENTAL_AGREEMENT_ABI, signerOrProvider);
}

/**
 * Reads complete state of an individual RentalAgreement.
 */
export async function fetchAgreementDetails(address, provider) {
  if (!ethers.isAddress(address)) {
    throw new Error("Invalid contract address format");
  }

  const contract = getAgreementContract(address, provider);

  const [
    landlordAddr,
    tenantAddr,
    rentAmount,
    securityDeposit,
    startTime,
    lastRentPaid,
    rentPaidUntil,
    claimableRent,
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
    contract.rentPaidUntil ? contract.rentPaidUntil().catch(() => 0n) : 0n,
    contract.claimableRent ? contract.claimableRent().catch(() => 0n) : 0n,
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
    rentPaidUntil: Number(rentPaidUntil),
    claimableRent,
    duration: Number(duration),
    active,
    propertyAddress,
    documentHash,
    balance
  };
}
