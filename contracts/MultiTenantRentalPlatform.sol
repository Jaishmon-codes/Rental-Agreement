// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MultiTenantRentalPlatform
 * @notice Enterprise-grade decentralized rental ledger for multi-tenant property management SaaS.
 * Denominated in stable values (USD/INR equivalents) representing off-chain document hashes,
 * version controls, audit trails, and relayer-signed signature locks.
 */
contract MultiTenantRentalPlatform {

    struct Agreement {
        uint256 agreementId;
        string companyId;          // SaaS Tenant Organization ID
        address landlord;
        address tenant;
        uint256 rentInINR;
        uint256 securityDepositInINR;
        string propertyDetails;
        string currentDocumentHash; // SHA256 of the active PDF lease agreement
        uint256 startTime;
        uint256 durationInDays;
        uint256 lastRentPaidTimestamp;
        uint256 currentVersion;     // Version control counter
        bool isSignedByLandlord;
        bool isSignedByTenant;
        bool active;
        bool locked;                // Locked after both signatures are completed
    }

    struct AgreementVersion {
        uint256 versionNumber;
        string documentHash;
        uint256 timestamp;
        string changeSummary;
    }

    // agreementId => Agreement details
    mapping(uint256 => Agreement) public agreements;
    // agreementId => list of historic versions
    mapping(uint256 => AgreementVersion[]) public agreementVersions;
    // companyId => list of agreementIds owned by this SaaS tenant
    mapping(string => uint256[]) public companyAgreements;

    uint256 public nextAgreementId = 1;
    address public platformAdmin;

    // ---------------- EVENTS ----------------
    event AgreementCreated(uint256 indexed agreementId, string companyId, address indexed landlord, string propertyDetails);
    event AgreementSigned(uint256 indexed agreementId, address indexed signer, string role);
    event AgreementLocked(uint256 indexed agreementId, string documentHash, uint256 timestamp);
    event AgreementVersionAdded(uint256 indexed agreementId, uint256 version, string documentHash, string changeSummary);
    event RentPaymentLogged(uint256 indexed agreementId, address indexed payer, uint256 amountINR, uint256 nextDueTimestamp);
    event LeaseTerminated(uint256 indexed agreementId, address indexed terminator, uint256 timestamp);

    modifier onlyPlatformAdmin() {
        require(msg.sender == platformAdmin, "Only platform admin allowed");
        _;
    }

    modifier onlyLandlord(uint256 _agreementId) {
        require(msg.sender == agreements[_agreementId].landlord, "Only landlord allowed");
        _;
    }

    modifier onlyParties(uint256 _agreementId) {
        require(
            msg.sender == agreements[_agreementId].landlord || 
            msg.sender == agreements[_agreementId].tenant ||
            msg.sender == platformAdmin,
            "Access denied: Not a party to this agreement"
        );
        _;
    }

    constructor() {
        platformAdmin = msg.sender;
    }

    // ---------------- 1. CREATE AGREEMENT (Denominated in INR/Stable values) ----------------
    function createAgreement(
        string memory _companyId,
        address _landlord,
        address _tenant,
        uint256 _rentInINR,
        uint256 _depositInINR,
        string memory _propertyDetails,
        string memory _pdfHash
    ) external returns (uint256) {
        require(_landlord != address(0) && _tenant != address(0), "Invalid addresses");
        require(_rentInINR > 0 && _depositInINR > 0, "Amounts must be positive");

        uint256 agreementId = nextAgreementId++;
        
        Agreement storage newAgreement = agreements[agreementId];
        newAgreement.agreementId = agreementId;
        newAgreement.companyId = _companyId;
        newAgreement.landlord = _landlord;
        newAgreement.tenant = _tenant;
        newAgreement.rentInINR = _rentInINR;
        newAgreement.securityDepositInINR = _depositInINR;
        newAgreement.propertyDetails = _propertyDetails;
        newAgreement.currentDocumentHash = _pdfHash;
        newAgreement.currentVersion = 1;
        newAgreement.active = false;
        newAgreement.locked = false;

        // Log initial version
        agreementVersions[agreementId].push(AgreementVersion({
            versionNumber: 1,
            documentHash: _pdfHash,
            timestamp: block.timestamp,
            changeSummary: "Initial lease drafting"
        }));

        companyAgreements[_companyId].push(agreementId);

        emit AgreementCreated(agreementId, _companyId, _landlord, _propertyDetails);
        emit AgreementVersionAdded(agreementId, 1, _pdfHash, "Initial lease drafting");

        return agreementId;
    }

    // ---------------- 2. VERSION CONTROL (Requirement 5) ----------------
    function updateAgreementDraft(
        uint256 _agreementId,
        string memory _newPdfHash,
        string memory _changeSummary
    ) external onlyParties(_agreementId) {
        Agreement storage agreement = agreements[_agreementId];
        require(!agreement.locked, "Cannot edit: agreement is locked and signed");

        agreement.currentVersion++;
        agreement.currentDocumentHash = _newPdfHash;
        
        // Reset signatures since document terms changed
        agreement.isSignedByLandlord = false;
        agreement.isSignedByTenant = false;

        agreementVersions[_agreementId].push(AgreementVersion({
            versionNumber: agreement.currentVersion,
            documentHash: _newPdfHash,
            timestamp: block.timestamp,
            changeSummary: _changeSummary
        }));

        emit AgreementVersionAdded(_agreementId, agreement.currentVersion, _newPdfHash, _changeSummary);
    }

    // ---------------- 3. DIGITAL SIGNATURES / LOCKS (Requirement 3, 10) ----------------
    
    // Direct Web3 Signature
    function signAgreement(uint256 _agreementId) external onlyParties(_agreementId) {
        _sign(_agreementId, msg.sender);
    }

    // Relayer Signature (Allows Aadhaar eSign, OTP-based Web2 signatures via platform admin gasless relay)
    function signAgreementForParty(uint256 _agreementId, address _party) external onlyPlatformAdmin {
        _sign(_agreementId, _party);
    }

    function _sign(uint256 _agreementId, address _signer) internal {
        Agreement storage agreement = agreements[_agreementId];
        require(!agreement.locked, "Agreement already signed and locked");

        if (_signer == agreement.landlord) {
            agreement.isSignedByLandlord = true;
            emit AgreementSigned(_agreementId, _signer, "Landlord");
        } else if (_signer == agreement.tenant) {
            agreement.isSignedByTenant = true;
            emit AgreementSigned(_agreementId, _signer, "Tenant");
        } else {
            revert("Signer is not a valid party");
        }

        // Auto-lock when both parties sign (Requirement 10)
        if (agreement.isSignedByLandlord && agreement.isSignedByTenant) {
            agreement.locked = true;
            agreement.active = true;
            agreement.startTime = block.timestamp;
            agreement.lastRentPaidTimestamp = block.timestamp;
            emit AgreementLocked(_agreementId, agreement.currentDocumentHash, block.timestamp);
        }
    }

    // ---------------- 4. AUDITABLE PAYMENT LOGGING (Requirement 6, 9) ----------------
    // Logs fiat-based INR payments (e.g. from Razorpay hook) onto the audit trail
    function logRentPayment(
        uint256 _agreementId,
        uint256 _amountINR,
        uint256 _nextDueTimestamp
    ) external onlyPlatformAdmin {
        Agreement storage agreement = agreements[_agreementId];
        require(agreement.active, "Agreement not active");

        agreement.lastRentPaidTimestamp = block.timestamp;

        emit RentPaymentLogged(_agreementId, agreement.tenant, _amountINR, _nextDueTimestamp);
    }

    // ---------------- 5. TERMINATE AGREEMENT (Requirement 6) ----------------
    function terminateAgreement(uint256 _agreementId) external onlyParties(_agreementId) {
        Agreement storage agreement = agreements[_agreementId];
        require(agreement.active, "Agreement already closed");

        agreement.active = false;
        emit LeaseTerminated(_agreementId, msg.sender, block.timestamp);
    }

    // ---------------- VIEW HELPERS ----------------
    function getVersions(uint256 _agreementId) external view returns (AgreementVersion[] memory) {
        return agreementVersions[_agreementId];
    }

    function getCompanyAgreements(string memory _companyId) external view returns (uint256[] memory) {
        return companyAgreements[_companyId];
    }
}
