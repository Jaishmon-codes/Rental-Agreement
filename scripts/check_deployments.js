import pkg from "hardhat";
const { ethers } = pkg;
import { RENTAL_AGREEMENT_FACTORY_ABI } from "../frontend/src/contracts/abis.js";
import { CONTRACT_ADDRESSES } from "../frontend/src/contracts/contractAddress.js";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Checking deployments using account:", deployer.address);

  const factory = await ethers.getContractAt(
    "RentalAgreementFactory",
    CONTRACT_ADDRESSES.RentalAgreementFactory
  );

  const allAgreements = await factory.getAllAgreements();
  console.log(`Total agreements in factory: ${allAgreements.length}`);

  for (let i = 0; i < allAgreements.length; i++) {
    const addr = allAgreements[i];
    const agreement = await ethers.getContractAt("RentalAgreement", addr);
    const landlord = await agreement.landlord();
    const tenant = await agreement.tenant();
    const propAddr = await agreement.propertyAddress();
    const active = await agreement.active();
    console.log(`[${i}] Address: ${addr}`);
    console.log(`    Property: ${propAddr}`);
    console.log(`    Landlord: ${landlord}`);
    console.log(`    Tenant:   ${tenant}`);
    console.log(`    Active:   ${active}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
