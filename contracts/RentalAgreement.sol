// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRentalAgreementFactory {
    function registerTenantAssociation(address _tenant) external;
}

contract RentalAgreement {

    enum Status {
        CREATED,
        ACTIVE,
        TERMINATION_REQUESTED,
        DISPUTED,
        SETTLED,
        EXPIRED
    }

    address public landlord;
    address public tenant;
    address public immutable arbitrator;

    uint public rentAmount;
    uint public securityDeposit;

    uint public startTime;
    uint public lastRentPaid;
    uint public rentPaidUntil;
    uint public claimableRent;

    uint public duration;
    bool public active;
    Status public status = Status.CREATED;

    string public propertyAddress;
    string public documentHash; // IPFS CID or digital lease doc link

    address public factory;
    bool private locked;

    // Dispute timelock parameters
    uint public constant DISPUTE_PERIOD = 3 days;
    uint public terminationRequestedAt;
    bool public damageClaimed;
    string public damageReason;

    // Pull-over-Push withdrawal tracking (CRIT-03 protection against reverting receivers)
    mapping(address => uint) public pendingWithdrawals;

    // ---------------- EVENTS ----------------
    event TenantJoined(address indexed tenant, uint startTime, uint timestamp);
    event RentPaid(address indexed tenant, uint amount, uint nextDue, uint timestamp);
    event RentClaimed(address indexed landlord, uint amount, uint timestamp);
    event AgreementEnded(address indexed landlord, address indexed tenant, bool propertyOk, uint timestamp);
    event AutoExpired(address indexed tenant, uint refundAmount, uint timestamp);
    event TerminationRequested(address indexed landlord, uint disputeDeadline, string reason, uint timestamp);
    event DisputeRaised(address indexed tenant, string reason, uint timestamp);
    event DisputeResolved(address indexed resolver, uint landlordAmount, uint tenantAmount, uint timestamp);
    event ClaimFinalized(address indexed landlord, uint amount, uint timestamp);
    event WithdrawalCredited(address indexed recipient, uint amount, uint timestamp);
    event WithdrawalProcessed(address indexed recipient, uint amount, uint timestamp);

    constructor(
        address _landlord,
        address _arbitrator,
        uint _rentAmount,
        uint _deposit,
        uint _durationInDays,
        string memory _propertyAddress,
        string memory _documentHash
    ) {
        require(_landlord != address(0), "Invalid landlord address");
        require(_arbitrator != address(0), "Invalid arbitrator address");
        require(_rentAmount > 0, "Rent must be positive");
        require(_deposit > 0, "Deposit must be positive");
        require(_durationInDays > 0, "Duration must be positive");

        landlord = _landlord;
        arbitrator = _arbitrator;
        rentAmount = _rentAmount;
        securityDeposit = _deposit;
        duration = _durationInDays * 1 days;
        propertyAddress = _propertyAddress;
        documentHash = _documentHash;
        factory = msg.sender; // The factory deploys this, so factory is msg.sender
    }

    // ---------------- MODIFIERS ----------------

    modifier onlyLandlord() {
        require(msg.sender == landlord, "Not landlord");
        _;
    }

    modifier onlyTenant() {
        require(msg.sender == tenant, "Not tenant");
        _;
    }

    modifier isActive() {
        require(active, "Contract not active");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    // ---------------- SAFE TRANSFER / PULL-OVER-PUSH ----------------

    /**
     * @dev Attempts push transfer; if recipient reverts or rejects, credits pendingWithdrawals.
     * Prevents permanent DoS lockup from malicious/reverting receivers (CRIT-03).
     */
    function _safeTransferOrCredit(address recipient, uint amount) internal {
        if (amount == 0) return;
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            pendingWithdrawals[recipient] += amount;
            emit WithdrawalCredited(recipient, amount, block.timestamp);
        }
    }

    /**
     * @dev Allows users whose push transfer reverted to pull their funds safely.
     */
    function withdrawRefund() external nonReentrant {
        uint amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No pending withdrawal");
        pendingWithdrawals[msg.sender] = 0;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdrawal transfer failed");
        emit WithdrawalProcessed(msg.sender, amount, block.timestamp);
    }

    // ---------------- JOIN CONTRACT ----------------

    // Tenant joins by paying deposit + first rent (Direct Web3 route)
    function joinAsTenant() external payable nonReentrant {
        _joinAsTenant(msg.sender);
    }

    // Relayer joins on behalf of a tenant (INR Gateway route)
    function joinAsTenantFor(address _tenant) external payable nonReentrant {
        require(_tenant != address(0), "Invalid tenant address");
        _joinAsTenant(_tenant);
    }

    function _joinAsTenant(address _tenantAddress) internal {
        require(tenant == address(0), "Already rented");
        require(_tenantAddress != landlord, "Landlord cannot be tenant");
        require(
            msg.value == rentAmount + securityDeposit,
            "Incorrect payment: must be rent + deposit"
        );

        tenant = _tenantAddress;
        startTime = block.timestamp;
        lastRentPaid = block.timestamp;
        rentPaidUntil = block.timestamp + 30 days;
        claimableRent = rentAmount;
        active = true;
        status = Status.ACTIVE;

        // Register tenant association in factory
        try IRentalAgreementFactory(factory).registerTenantAssociation(_tenantAddress) {} catch {}

        emit TenantJoined(_tenantAddress, startTime, block.timestamp);
    }

    // ---------------- RENT SYSTEM ----------------

    // Tenant pays next rent (Direct Web3 route)
    function payNextRent() external payable onlyTenant isActive nonReentrant {
        _payNextRent(msg.sender);
    }

    // Relayer pays next rent on behalf of a tenant (INR Gateway route)
    function payNextRentFor(address _tenant) external payable isActive nonReentrant {
        require(_tenant == tenant, "Not the registered tenant");
        _payNextRent(_tenant);
    }

    function _payNextRent(address _tenantAddress) internal {
        require(msg.value == rentAmount, "Wrong rent amount");
        
        rentPaidUntil += 30 days;
        claimableRent += msg.value;
        lastRentPaid = block.timestamp;

        emit RentPaid(_tenantAddress, msg.value, rentPaidUntil, block.timestamp);
    }

    // Landlord claims available rent
    function claimRent() external onlyLandlord nonReentrant {
        require(claimableRent > 0, "No rent available to claim");

        uint amountToClaim = claimableRent;
        claimableRent = 0;

        _safeTransferOrCredit(landlord, amountToClaim);

        emit RentClaimed(landlord, amountToClaim, block.timestamp);
    }

    // ---------------- END AGREEMENT & DISPUTE TIMELOCK ----------------

    /**
     * @dev End agreement. If propertyOk == true, deposit is refunded immediately to tenant.
     * If propertyOk == false, begins DISPUTE_PERIOD timelock to prevent unilateral deposit seizure (CRIT-02).
     */
    function endAgreement(bool propertyOk)
        external
        onlyLandlord
        isActive
        nonReentrant
    {
        active = false;

        if (propertyOk) {
            status = Status.SETTLED;
            _safeTransferOrCredit(tenant, securityDeposit);
            emit AgreementEnded(landlord, tenant, true, block.timestamp);
        } else {
            status = Status.TERMINATION_REQUESTED;
            damageClaimed = true;
            terminationRequestedAt = block.timestamp;
            emit TerminationRequested(landlord, block.timestamp + DISPUTE_PERIOD, "Damage claimed by landlord", block.timestamp);
            emit AgreementEnded(landlord, tenant, false, block.timestamp);
        }
    }

    /**
     * @dev Tenant explicitly accepts landlord damage claim to settle immediately.
     */
    function acceptClaim() external onlyTenant nonReentrant {
        require(status == Status.TERMINATION_REQUESTED, "No termination claim to accept");
        status = Status.SETTLED;
        _safeTransferOrCredit(landlord, securityDeposit);
        emit ClaimFinalized(landlord, securityDeposit, block.timestamp);
    }

    /**
     * @dev Tenant disputes landlord damage claim within DISPUTE_PERIOD.
     */
    function disputeClaim(string calldata reason) external onlyTenant nonReentrant {
        require(status == Status.TERMINATION_REQUESTED, "No active claim to dispute");
        require(block.timestamp <= terminationRequestedAt + DISPUTE_PERIOD, "Dispute window has elapsed");
        status = Status.DISPUTED;
        damageReason = reason;
        emit DisputeRaised(tenant, reason, block.timestamp);
    }

    /**
     * @dev Landlord finalizes damage claim after DISPUTE_PERIOD expires without tenant dispute.
     */
    function finalizeClaim() external nonReentrant {
        require(status == Status.TERMINATION_REQUESTED, "Not pending termination claim");
        require(block.timestamp > terminationRequestedAt + DISPUTE_PERIOD, "Dispute window still open");
        status = Status.SETTLED;
        _safeTransferOrCredit(landlord, securityDeposit);
        emit ClaimFinalized(landlord, securityDeposit, block.timestamp);
    }

    /**
     * @dev Authorized arbitrator resolves disputed claim with mutual split.
     */
    function resolveDispute(uint landlordShare, uint tenantShare) external nonReentrant {
        require(status == Status.DISPUTED, "Contract is not in dispute");
        require(msg.sender == arbitrator, "Unauthorized arbitrator");
        require(landlordShare + tenantShare == securityDeposit, "Invalid split total");

        status = Status.SETTLED;
        _safeTransferOrCredit(landlord, landlordShare);
        _safeTransferOrCredit(tenant, tenantShare);
        emit DisputeResolved(msg.sender, landlordShare, tenantShare, block.timestamp);
    }

    // ---------------- AUTO EXPIRY ----------------

    // Anyone can call after duration ends
    function autoExpire() external nonReentrant {
        require(
            block.timestamp >= startTime + duration,
            "Still active"
        );
        require(active, "Already closed");

        active = false;
        status = Status.EXPIRED;

        _safeTransferOrCredit(tenant, securityDeposit);

        emit AutoExpired(tenant, securityDeposit, block.timestamp);
    }

    // ---------------- VIEW HELPERS ----------------

    // Check contract balance
    function getBalance() external view returns(uint) {
        return address(this).balance;
    }
}
