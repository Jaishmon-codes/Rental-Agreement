import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // 1. Deploy RentalAgreementFactory (Option A / Single Leases)
  const Factory = await ethers.getContractFactory("RentalAgreementFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("RentalAgreementFactory deployed to:", factoryAddress);

  // 2. Deploy MultiTenantRentalPlatform (SaaS / Enterprise ledger)
  console.log("Deploying MultiTenantRentalPlatform...");
  const Platform = await ethers.getContractFactory("MultiTenantRentalPlatform");
  const platform = await Platform.deploy();
  await platform.waitForDeployment();
  const platformAddress = await platform.getAddress();
  console.log("MultiTenantRentalPlatform deployed to:", platformAddress);

  // Deploy a sample agreement for testing Option A
  const rentAmount = ethers.parseEther("0.05"); // 0.05 ETH
  const securityDeposit = ethers.parseEther("0.1"); // 0.1 ETH
  const durationInDays = 30;
  const propertyAddress = "742 Evergreen Terrace, Springfield";
  const documentHash = "QmYwAPJzv5CZ1gtjT3yGPg5sX8rTjK6P7H2p7B114K4P56";

  console.log("Deploying a sample agreement...");
  const tx = await factory.createAgreement(
    rentAmount,
    securityDeposit,
    durationInDays,
    propertyAddress,
    documentHash
  );
  const receipt = await tx.wait();
  
  const event = receipt.logs.find(
    (log) => factory.interface.parseLog(log)?.name === "AgreementCreated"
  );
  const sampleAgreementAddress = factory.interface.parseLog(event).args.agreementAddress;
  console.log("Sample agreement deployed to:", sampleAgreementAddress);

  // Automatically sync addresses to frontend
  import("node:fs").then(({ writeFileSync }) => {
    const content = `export const CONTRACT_ADDRESSES = {
  RentalAgreementFactory: "${factoryAddress}",
  MultiTenantRentalPlatform: "${platformAddress}",
  SampleAgreement: "${sampleAgreementAddress}"
};
`;
    writeFileSync("./frontend/src/contracts/contractAddress.js", content);
    console.log("Updated frontend/src/contracts/contractAddress.js successfully!");
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
