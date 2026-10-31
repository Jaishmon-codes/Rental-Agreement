// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RentalAgreement.sol";

contract RentalAgreementFactory {

    address[] public allAgreements;
    mapping(address => bool) public isAgreement;

    // Factory owner and authorized dispute arbitrator
    address public owner;
    address public arbitrator;

    // Track agreements by landlord
    mapping(address => address[]) public landlordToAgreements;
    
    // Track agreements by tenant
    mapping(address => address[]) public tenantToAgreements;

    event ArbitratorUpdated(address indexed previousArbitrator, address indexed newArbitrator);

    event AgreementCreated(
        address indexed agreementAddress,
        address indexed landlord,
        uint rentAmount,
        uint securityDeposit,
        uint duration,
        string propertyAddress,
        string documentHash
    );

    event TenantAssociated(
        address indexed agreementAddress,
        address indexed tenant
    );

    constructor() {
        owner = msg.sender;
        arbitrator = msg.sender;
    }

    function setArbitrator(address _newArbitrator) external {
        require(msg.sender == owner, "Only factory owner can set arbitrator");
        require(_newArbitrator != address(0), "Invalid arbitrator address");
        emit ArbitratorUpdated(arbitrator, _newArbitrator);
        arbitrator = _newArbitrator;
    }

    function createAgreement(
        uint _rentAmount,
        uint _deposit,
        uint _durationInDays,
        string memory _propertyAddress,
        string memory _documentHash
    ) external returns (address) {
        // Deploy a new RentalAgreement contract, passing the deployer (msg.sender) as landlord and configured arbitrator
        RentalAgreement newAgreement = new RentalAgreement(
            msg.sender,
            arbitrator,
            _rentAmount,
            _deposit,
            _durationInDays,
            _propertyAddress,
            _documentHash
        );

        address agreementAddr = address(newAgreement);
        allAgreements.push(agreementAddr);
        isAgreement[agreementAddr] = true;
        landlordToAgreements[msg.sender].push(agreementAddr);

        emit AgreementCreated(
            agreementAddr,
            msg.sender,
            _rentAmount,
            _deposit,
            _durationInDays,
            _propertyAddress,
            _documentHash
        );

        return agreementAddr;
    }

    // Called by the RentalAgreement contract when a tenant joins
    function registerTenantAssociation(address _tenant) external {
        require(isAgreement[msg.sender], "Only verified agreements can register");
        tenantToAgreements[_tenant].push(msg.sender);
        emit TenantAssociated(msg.sender, _tenant);
    }

    // Helper functions for frontend
    function getLandlordAgreements(address _landlord) external view returns (address[] memory) {
        return landlordToAgreements[_landlord];
    }

    function getTenantAgreements(address _tenant) external view returns (address[] memory) {
        return tenantToAgreements[_tenant];
    }

    function getAllAgreements() external view returns (address[] memory) {
        return allAgreements;
    }

    function getAgreementsCount() external view returns (uint) {
        return allAgreements.length;
    }

    /**
     * @dev Paginated retrieval to prevent out-of-gas / RPC payload limits on large arrays (MED-04)
     */
    function getAgreementsPaginated(uint offset, uint limit) external view returns (address[] memory agreementsPage, uint total) {
        total = allAgreements.length;
        if (offset >= total || limit == 0) {
            return (new address[](0), total);
        }
        uint end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint count = end - offset;
        agreementsPage = new address[](count);
        for (uint i = 0; i < count; i++) {
            agreementsPage[i] = allAgreements[offset + i];
        }
        return (agreementsPage, total);
    }
}
