// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRentalAgreementFactory {
    function registerTenantAssociation(address _tenant) external;
}

contract RentalAgreement {

    address public landlord;
    address public tenant;

    uint public rentAmount;
    uint public securityDeposit;

    uint public startTime;
    uint public lastRentPaid;
    uint public rentPaidUntil;
    uint public claimableRent;

    uint public duration;
    bool public active;

    string public propertyAddress;
    string public documentHash; // IPFS CID or digital lease doc link

    address public factory;
    bool private locked;

    // ---------------- EVENTS ----------------
    event TenantJoined(address indexed tenant, uint startTime, uint timestamp);
    event RentPaid(address indexed tenant, uint amount, uint nextDue, uint timestamp);
    event RentClaimed(address indexed landlord, uint amount, uint timestamp);
    event AgreementEnded(address indexed landlord, address indexed tenant, bool propertyOk, uint timestamp);
    event AutoExpired(address indexed tenant, uint refundAmount, uint timestamp);

    constructor(
        address _landlord,
        uint _rentAmount,
        uint _deposit,
        uint _durationInDays,
        string memory _propertyAddress,
        string memory _documentHash
    ) {
        require(_landlord != address(0), "Invalid landlord address");
        require(_rentAmount > 0, "Rent must be positive");
        require(_deposit > 0, "Deposit must be positive");
        require(_durationInDays > 0, "Duration must be positive");

        landlord = _landlord;
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

        (bool success, ) = landlord.call{value: amountToClaim}("");
        require(success, "Rent transfer failed");

        emit RentClaimed(landlord, amountToClaim, block.timestamp);
    }

    // ---------------- END AGREEMENT ----------------

    // End contract and release deposit
    function endAgreement(bool propertyOk)
        external
        onlyLandlord
        isActive
        nonReentrant
    {
        active = false;

        if (propertyOk) {
            (bool success, ) = tenant.call{value: securityDeposit}("");
            require(success, "Refund failed");
        } else {
            (bool success, ) = landlord.call{value: securityDeposit}("");
            require(success, "Deposit transfer failed");
        }

        emit AgreementEnded(landlord, tenant, propertyOk, block.timestamp);
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

        (bool success, ) = tenant.call{value: securityDeposit}("");
        require(success, "Auto refund failed");

        emit AutoExpired(tenant, securityDeposit, block.timestamp);
    }

    // ---------------- VIEW HELPERS ----------------

    // Check contract balance
    function getBalance() external view returns(uint) {
        return address(this).balance;
    }
}
