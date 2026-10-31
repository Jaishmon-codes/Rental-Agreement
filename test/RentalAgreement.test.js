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

      it("should end agreement and enforce dispute timelock before giving deposit to landlord if property is NOT OK", async function () {
        const landlordBalanceBefore = await ethers.provider.getBalance(landlord.address);
        
        // Landlord initiates claim
        const tx = await agreement.connect(landlord).endAgreement(false);
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        expect(await agreement.active()).to.be.false;
        expect(await agreement.status()).to.equal(2n); // Status.TERMINATION_REQUESTED
        expect(await agreement.damageClaimed()).to.be.true;

        // CRIT-02 Protection: Landlord cannot immediately seize funds
        const balanceMid = await ethers.provider.getBalance(landlord.address);
        expect(balanceMid + gasUsed - landlordBalanceBefore).to.equal(0n);

        // Premature finalization should revert
        await expect(agreement.finalizeClaim()).to.be.revertedWith("Dispute window still open");

        // Advance past dispute period (3 days)
        await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine");

        // Landlord finalizes claim
        const finalTx = await agreement.connect(landlord).finalizeClaim();
        const finalReceipt = await finalTx.wait();
        const finalGas = finalReceipt.gasUsed * finalReceipt.gasPrice;

        const landlordBalanceAfter = await ethers.provider.getBalance(landlord.address);
        expect(landlordBalanceAfter + gasUsed + finalGas - landlordBalanceBefore).to.equal(securityDeposit);
        expect(await agreement.status()).to.equal(4n); // Status.SETTLED
      });

      it("CRIT-02: should allow tenant to dispute damage claim within window", async function () {
        await agreement.connect(landlord).endAgreement(false);
        expect(await agreement.status()).to.equal(2n); // TERMINATION_REQUESTED

        // Tenant disputes
        await agreement.connect(tenant).disputeClaim("Normal wear and tear; damage not caused by tenant");
        expect(await agreement.status()).to.equal(3n); // DISPUTED
        expect(await agreement.damageReason()).to.equal("Normal wear and tear; damage not caused by tenant");

        // Finalize claim reverts because contract is in dispute
        await ethers.provider.send("evm_increaseTime", [4 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await expect(agreement.finalizeClaim()).to.be.revertedWith("Not pending termination claim");

        // Adversarial Check: Landlord attempts resolveDispute() -> REVERTS
        const tenantShare = ethers.parseEther("0.1");
        const landlordShare = ethers.parseEther("0.1");
        await expect(
          agreement.connect(landlord).resolveDispute(landlordShare, tenantShare)
        ).to.be.revertedWith("Unauthorized arbitrator");

        // Adversarial Check: Tenant attempts resolveDispute() -> REVERTS
        await expect(
          agreement.connect(tenant).resolveDispute(tenantShare, landlordShare)
        ).to.be.revertedWith("Unauthorized arbitrator");

        // Adversarial Check: Third party attempts resolveDispute() -> REVERTS
        await expect(
          agreement.connect(other).resolveDispute(landlordShare, tenantShare)
        ).to.be.revertedWith("Unauthorized arbitrator");

        // Adversarial Check: Arbitrator attempts invalid split total -> REVERTS
        await expect(
          agreement.connect(owner).resolveDispute(ethers.parseEther("0.15"), ethers.parseEther("0.15"))
        ).to.be.revertedWith("Invalid split total");

        // Authorized arbitrator resolves dispute with fair split
        await agreement.connect(owner).resolveDispute(landlordShare, tenantShare);
        expect(await agreement.status()).to.equal(4n); // SETTLED

        // Adversarial Check: Repeated resolution after already resolved -> REVERTS
        await expect(
          agreement.connect(owner).resolveDispute(landlordShare, tenantShare)
        ).to.be.revertedWith("Contract is not in dispute");
      });

      it("CRIT-02: should prevent dispute resolution before contract enters DISPUTED status", async function () {
        await expect(
          agreement.connect(owner).resolveDispute(ethers.parseEther("0.1"), ethers.parseEther("0.1"))
        ).to.be.revertedWith("Contract is not in dispute");
      });

      it("CRIT-02: should allow tenant to accept damage claim immediately", async function () {
        await agreement.connect(landlord).endAgreement(false);

        const landlordBalBefore = await ethers.provider.getBalance(landlord.address);
        await agreement.connect(tenant).acceptClaim();

        const landlordBalAfter = await ethers.provider.getBalance(landlord.address);
        expect(landlordBalAfter - landlordBalBefore).to.equal(securityDeposit);
        expect(await agreement.status()).to.equal(4n); // SETTLED
      });

      it("should reject invalid rent payment amounts", async function () {
        await expect(
          agreement.connect(tenant).payNextRent({ value: ethers.parseEther("0.01") })
        ).to.be.revertedWith("Wrong rent amount");

        await expect(
          agreement.connect(tenant).payNextRent({ value: rentAmount * 2n })
        ).to.be.revertedWith("Wrong rent amount");
      });

      it("should enforce access control on landlord actions", async function () {
        await expect(
          agreement.connect(tenant).claimRent()
        ).to.be.revertedWith("Not landlord");

        await expect(
          agreement.connect(other).claimRent()
        ).to.be.revertedWith("Not landlord");

        await expect(
          agreement.connect(tenant).endAgreement(true)
        ).to.be.revertedWith("Not landlord");
      });

      it("should prevent invalid state transitions on closed contracts", async function () {
        // End the agreement first
        await agreement.connect(landlord).endAgreement(true);

        // Cannot pay rent on closed contract
        await expect(
          agreement.connect(tenant).payNextRent({ value: rentAmount })
        ).to.be.revertedWith("Contract not active");

        // Cannot end an already closed contract
        await expect(
          agreement.connect(landlord).endAgreement(true)
        ).to.be.revertedWith("Contract not active");
      });

      it("should prevent premature auto-expiry before duration has elapsed", async function () {
        // Only 10 days elapsed, duration is 30 days
        await ethers.provider.send("evm_increaseTime", [10 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await expect(
          agreement.autoExpire()
        ).to.be.revertedWith("Still active");
      });

      it("should prevent auto-expiry on already closed agreement", async function () {
        // End agreement first
        await agreement.connect(landlord).endAgreement(true);

        // Advance time past duration
        await ethers.provider.send("evm_increaseTime", [35 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await expect(
          agreement.autoExpire()
        ).to.be.revertedWith("Already closed");
      });

      it("should allow auto-expiry and refund tenant after duration ends", async function () {
        // Advance time past duration (30 days)
        await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine");

        const tenantBalanceBefore = await ethers.provider.getBalance(tenant.address);
        const tx = await agreement.autoExpire();
        await tx.wait();

        expect(await agreement.active()).to.be.false;
        const tenantBalanceAfter = await ethers.provider.getBalance(tenant.address);
        expect(tenantBalanceAfter - tenantBalanceBefore).to.equal(securityDeposit);
      });

      it("CRIT-03 Defense: Reverting receiver cannot DoS contract during termination or autoExpire (Pull-over-Push)", async function () {
        // Deploy a new agreement for reverting receiver test
        const createTx = await factory.connect(landlord).createAgreement(
          rentAmount,
          securityDeposit,
          durationInDays,
          "Revert Test Property",
          "doc_revert_hash"
        );
        const receipt = await createTx.wait();
        const event = receipt.logs.find(
          (log) => factory.interface.parseLog(log)?.name === "AgreementCreated"
        );
        const revAgreementAddr = factory.interface.parseLog(event).args.agreementAddress;
        const revAgreement = await ethers.getContractAt("RentalAgreement", revAgreementAddr);

        // Deploy malicious reverting receiver contract
        const ReverterFactory = await ethers.getContractFactory("RevertingReceiver");
        const reverter = await ReverterFactory.deploy();
        await reverter.waitForDeployment();
        const reverterAddress = await reverter.getAddress();

        // Reverting contract joins as tenant
        await reverter.join(revAgreementAddr, { value: rentAmount + securityDeposit });
        expect(await revAgreement.tenant()).to.equal(reverterAddress);
        expect(await revAgreement.active()).to.be.true;

        // Landlord ends agreement (property ok -> refund to reverting tenant)
        // With Pull-over-Push, this must NOT revert even though reverter rejects ETH!
        const endTx = await revAgreement.connect(landlord).endAgreement(true);
        await endTx.wait();

        expect(await revAgreement.active()).to.be.false;
        expect(await revAgreement.status()).to.equal(4n); // Status.SETTLED

        // Deposit is safely credited in pendingWithdrawals
        expect(await revAgreement.pendingWithdrawals(reverterAddress)).to.equal(securityDeposit);

        // When reverter enables receiving ETH, it can pull its refund safely
        await reverter.setShouldRevert(false);
        const reverterBalBefore = await ethers.provider.getBalance(reverterAddress);
        await reverter.callWithdrawRefund(revAgreementAddr);
        const reverterBalAfter = await ethers.provider.getBalance(reverterAddress);

        expect(reverterBalAfter - reverterBalBefore).to.equal(securityDeposit);
        expect(await revAgreement.pendingWithdrawals(reverterAddress)).to.equal(0n);
      });

      it("Invariant Check: Contract balance is always >= securityDeposit while active", async function () {
        // Initially after join: rent + deposit
        expect(await agreement.getBalance()).to.equal(rentAmount + securityDeposit);

        // Landlord claims initial rent
        await (await agreement.connect(landlord).claimRent()).wait();
        expect(await agreement.getBalance()).to.equal(securityDeposit);

        // Tenant pays next rent
        await (await agreement.connect(tenant).payNextRent({ value: rentAmount })).wait();
        expect(await agreement.getBalance()).to.equal(rentAmount + securityDeposit);

        // Landlord claims again
        await (await agreement.connect(landlord).claimRent()).wait();
        // Invariant holds: balance is never depleted below securityDeposit
        expect(await agreement.getBalance()).to.be.at.least(securityDeposit);
      });
    });

    describe("Factory Scalability (MED-04)", function () {
      it("MED-04 Defense: should support paginated retrieval of agreements", async function () {
        for (let i = 0; i < 3; i++) {
          await (await factory.connect(landlord).createAgreement(
            rentAmount,
            securityDeposit,
            durationInDays,
            `Property ${i}`,
            `hash_${i}`
          )).wait();
        }

        const totalCount = await factory.getAgreementsCount();
        expect(totalCount).to.be.at.least(3n);

        const [page1, total1] = await factory.getAgreementsPaginated(0, 2);
        expect(page1.length).to.equal(2);
        expect(total1).to.equal(totalCount);

        const [page2, total2] = await factory.getAgreementsPaginated(2, 2);
        expect(page2.length).to.be.at.least(1);
        expect(total2).to.equal(totalCount);
      });
    });
  });
});
