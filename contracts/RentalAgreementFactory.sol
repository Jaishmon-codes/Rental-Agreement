// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RentalAgreement.sol";

contract RentalAgreementFactory {

    address[] public allAgreements;
    mapping(address => bool) public isAgreement;

    // Track agreements by landlord
    mapping(address => address[]) public landlordToAgreements;
    
    // Track agreements by tenant
    mapping(address => address[]) public tenantToAgreements;

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

    function createAgreement(
        uint _rentAmount,
        uint _deposit,
        uint _durationInDays,
        string memory _propertyAddress,
        string memory _documentHash
    ) external returns (address) {
        // Deploy a new RentalAgreement contract, passing the deployer (msg.sender) as the landlord
        RentalAgreement newAgreement = new RentalAgreement(
            msg.sender,
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
}
