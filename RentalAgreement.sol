
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RentalAgreement {

    address public landlord;
    address public tenant;

    uint public rentAmount;
    uint public securityDeposit;

    uint public startTime;
    uint public lastRentPaid;

    uint public duration;
    bool public active;

    constructor(
        uint _rentAmount,
        uint _deposit,
        uint _durationInDays
    ) {
        landlord = msg.sender;
        rentAmount = _rentAmount;
        securityDeposit = _deposit;
        duration = _durationInDays * 1 days;
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

    // ---------------- JOIN CONTRACT ----------------

    // Tenant joins by paying deposit + first rent
    function joinAsTenant() external payable {

        require(tenant == address(0), "Already rented");

        require(
            msg.value == rentAmount + securityDeposit,
            "Incorrect payment"
        );

        tenant = msg.sender;
        startTime = block.timestamp;
        lastRentPaid = block.timestamp;
        active = true;
    }

    // ---------------- RENT SYSTEM ----------------

    // Tenant pays next rent
    function payNextRent() external payable onlyTenant isActive {

        require(msg.value == rentAmount, "Wrong amount");
    }

    // Landlord claims monthly rent
    function claimRent() external onlyLandlord isActive {

        require(
            block.timestamp >= lastRentPaid + 30 days,
            "Too early to claim"
        );

        lastRentPaid = block.timestamp;

        (bool success, ) = landlord.call{value: rentAmount}("");
        require(success, "Rent transfer failed");
    }

    // ---------------- END AGREEMENT ----------------

    // End contract and release deposit
    function endAgreement(bool propertyOk)
        external
        onlyLandlord
        isActive
    {

        active = false;

        if (propertyOk) {

            (bool success, ) =
                tenant.call{value: securityDeposit}("");
            require(success, "Refund failed");

        } else {

            (bool success, ) =
                landlord.call{value: securityDeposit}("");
            require(success, "Deposit transfer failed");
        }
    }

    // ---------------- AUTO EXPIRY ----------------

    // Anyone can call after duration ends
    function autoExpire() external {

        require(
            block.timestamp >= startTime + duration,
            "Still active"
        );

        require(active, "Already closed");

        active = false;

        (bool success, ) =
            tenant.call{value: securityDeposit}("");
        require(success, "Auto refund failed");
    }

    // ---------------- VIEW HELPERS ----------------

    // Check contract balance
    function getBalance() external view returns(uint) {
        return address(this).balance;
    }

}
