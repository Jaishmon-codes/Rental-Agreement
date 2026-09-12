import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("RentalAgreement System", function () {
  let Factory, factory;
  let owner, landlord, tenant, other;
  let rentAmount = ethers.parseEther("0.1");
  let securityDeposit = ethers.parseEther("0.2");
  let durationInDays = 30; // 30 days
  let propertyAddress = "128 Blockchain Blvd, Apt 4B";
  let documentHash = "QmXoyp1eg2HZfX5H8D62H52H52H52H52H52H52H52H52H";

  beforeEach(async function () {
    [owner, landlord, tenant, other] = await ethers.getSigners();

    // Deploy Factory
    Factory = await ethers.getContractFactory("RentalAgreementFactory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();
  });

  describe("Factory Deployment", function () {
    it("should deploy a new RentalAgreement", async function () {
      const tx = await factory.connect(landlord).createAgreement(
        rentAmount,
        securityDeposit,
        durationInDays,
        propertyAddress,
        documentHash
      );

      const receipt = await tx.wait();
      
      // Check event
      const event = receipt.logs.find(
        (log) => factory.interface.parseLog(log)?.name === "AgreementCreated"
      );
      const parsedLog = factory.interface.parseLog(event);

      expect(parsedLog.args.landlord).to.equal(landlord.address);
      expect(parsedLog.args.rentAmount).to.equal(rentAmount);
      expect(parsedLog.args.securityDeposit).to.equal(securityDeposit);
      expect(parsedLog.args.propertyAddress).to.equal(propertyAddress);
      expect(parsedLog.args.documentHash).to.equal(documentHash);

      const agreementAddress = parsedLog.args.agreementAddress;
      expect(await factory.isAgreement(agreementAddress)).to.be.true;

      // Verify listing helpers
      const landlordAgreements = await factory.getLandlordAgreements(landlord.address);
      expect(landlordAgreements[0]).to.equal(agreementAddress);
    });
  });

  describe("RentalAgreement Lifecycle", function () {
    let agreementAddress, agreement;

    beforeEach(async function () {
      const tx = await factory.connect(landlord).createAgreement(
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
      agreementAddress = factory.interface.parseLog(event).args.agreementAddress;
      
      agreement = await ethers.getContractAt("RentalAgreement", agreementAddress);
    });

    it("should initialize correct state variables", async function () {
      expect(await agreement.landlord()).to.equal(landlord.address);
      expect(await agreement.rentAmount()).to.equal(rentAmount);
      expect(await agreement.securityDeposit()).to.equal(securityDeposit);
      expect(await agreement.duration()).to.equal(BigInt(durationInDays * 24 * 60 * 60));
      expect(await agreement.propertyAddress()).to.equal(propertyAddress);
      expect(await agreement.documentHash()).to.equal(documentHash);
      expect(await agreement.active()).to.be.false;
      expect(await agreement.tenant()).to.equal(ethers.ZeroAddress);
    });

    it("should prevent landlord from joining as tenant", async function () {
      await expect(
        agreement.connect(landlord).joinAsTenant({ value: rentAmount + securityDeposit })
      ).to.be.revertedWith("Landlord cannot be tenant");
    });

    it("should require correct deposit + rent payment to join", async function () {
      await expect(
        agreement.connect(tenant).joinAsTenant({ value: rentAmount })
      ).to.be.revertedWith("Incorrect payment: must be rent + deposit");
    });

    it("should allow tenant to join and trigger factory association", async function () {
      const joinTx = await agreement.connect(tenant).joinAsTenant({
        value: rentAmount + securityDeposit,
      });
      await joinTx.wait();

      expect(await agreement.tenant()).to.equal(tenant.address);
      expect(await agreement.active()).to.be.true;

      // Verify association in factory
      const tenantAgreements = await factory.getTenantAgreements(tenant.address);
      expect(tenantAgreements[0]).to.equal(agreementAddress);
    });

    describe("Active Agreement Actions", function () {
      beforeEach(async function () {
        await agreement.connect(tenant).joinAsTenant({
          value: rentAmount + securityDeposit,
        });
      });

      it("should allow tenant to pay rent", async function () {
        const tx = await agreement.connect(tenant).payNextRent({ value: rentAmount });
        const receipt = await tx.wait();
        
        // Assert Event Emitted
        const event = receipt.logs.find(
          (log) => agreement.interface.parseLog(log)?.name === "RentPaid"
        );
        const parsedLog = agreement.interface.parseLog(event);
        expect(parsedLog.args.tenant).to.equal(tenant.address);
        expect(parsedLog.args.amount).to.equal(rentAmount);
      });

      it("should prevent non-tenant from paying rent", async function () {
        await expect(
          agreement.connect(other).payNextRent({ value: rentAmount })
        ).to.be.revertedWith("Not tenant");
      });

      it("should allow landlord to claim initial month rent immediately upon tenant joining", async function () {
        const balanceBefore = await ethers.provider.getBalance(landlord.address);
        const claimTx = await agreement.connect(landlord).claimRent();
        const receipt = await claimTx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const balanceAfter = await ethers.provider.getBalance(landlord.address);

        expect(balanceAfter + gasUsed - balanceBefore).to.equal(rentAmount);
        expect(await agreement.claimableRent()).to.equal(0n);
        // Security deposit is untouched
        expect(await agreement.getBalance()).to.equal(securityDeposit);
      });

      it("should prevent landlord from claiming when no rent is available", async function () {
        // Claim the initial rent first
        await (await agreement.connect(landlord).claimRent()).wait();

        // Attempting to claim again should revert
        await expect(
          agreement.connect(landlord).claimRent()
        ).to.be.revertedWith("No rent available to claim");
      });

      it("should allow landlord to claim rent after tenant pays next rent", async function () {
        // First claim
        await (await agreement.connect(landlord).claimRent()).wait();

        // Tenant pays next rent
        await (await agreement.connect(tenant).payNextRent({ value: rentAmount })).wait();
        expect(await agreement.claimableRent()).to.equal(rentAmount);

        // Landlord claims next rent
        const balanceBefore = await ethers.provider.getBalance(landlord.address);
        const claimTx = await agreement.connect(landlord).claimRent();
        const receipt = await claimTx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const balanceAfter = await ethers.provider.getBalance(landlord.address);

        expect(balanceAfter + gasUsed - balanceBefore).to.equal(rentAmount);
        expect(await agreement.getBalance()).to.equal(securityDeposit);
      });

      it("should end agreement and refund tenant if property is OK", async function () {
        const tenantBalanceBefore = await ethers.provider.getBalance(tenant.address);
        
        const tx = await agreement.connect(landlord).endAgreement(true);
        await tx.wait();

        expect(await agreement.active()).to.be.false;

        const tenantBalanceAfter = await ethers.provider.getBalance(tenant.address);
        expect(tenantBalanceAfter - tenantBalanceBefore).to.equal(securityDeposit);
      });

      it("should end agreement and give deposit to landlord if property is NOT OK", async function () {
        const landlordBalanceBefore = await ethers.provider.getBalance(landlord.address);
        
        const tx = await agreement.connect(landlord).endAgreement(false);
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        expect(await agreement.active()).to.be.false;

        const landlordBalanceAfter = await ethers.provider.getBalance(landlord.address);
        expect(landlordBalanceAfter + gasUsed - landlordBalanceBefore).to.equal(securityDeposit);
      });

      it("should allow auto-expiry after agreement duration ends", async function () {
        // Increase time past duration (30 days)
        await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine");

        const tenantBalanceBefore = await ethers.provider.getBalance(tenant.address);
        const tx = await agreement.autoExpire();
        await tx.wait();

        expect(await agreement.active()).to.be.false;
        const tenantBalanceAfter = await ethers.provider.getBalance(tenant.address);
        expect(tenantBalanceAfter - tenantBalanceBefore).to.equal(securityDeposit);
      });
    });
  });
});
