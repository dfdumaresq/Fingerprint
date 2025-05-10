// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AIFingerprint
 * @dev Smart contract for registering and verifying AI agent fingerprints
 * @dev Uses OpenZeppelin's Ownable for access control and Pausable for emergency stops
 */
contract AIFingerprint is Ownable, Pausable {
    /**
     * @dev Constructor for AIFingerprint contract
     * @dev Initializes the Ownable contract with the deployer as the initial owner
     */
    constructor() Ownable(msg.sender) {
        // Contract is initialized with deployer as owner
    }

    /**
     * @dev Pause all contract functions
     * @dev Can only be called by the contract owner
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause all contract functions
     * @dev Can only be called by the contract owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    struct AgentData {
        string id;
        string name;
        string provider;
        string version;
        address registeredBy;
        uint256 createdAt;
        bool exists;
    }

    // Additional struct for revocation information
    struct RevocationData {
        bool revoked;
        uint256 revokedAt;
        address revokedBy;
    }

    // Mapping from fingerprint hash to agent data
    mapping(string => AgentData) private fingerprints;
    
    // Separate mapping for revocation information
    mapping(string => RevocationData) private revocations;
    
    // Event emitted when a new fingerprint is registered
    event FingerprintRegistered(
        string fingerprintHash,
        string id,
        string name,
        string provider,
        string version,
        address registeredBy,
        uint256 createdAt
    );

    // Event emitted when a fingerprint is revoked
    event FingerprintRevoked(
        string fingerprintHash,
        address revokedBy,
        uint256 revokedAt
    );

    // Event emitted when a fingerprint ownership is transferred
    event FingerprintOwnershipTransferred(
        string fingerprintHash,
        address previousOwner,
        address newOwner,
        uint256 transferredAt
    );

    /**
     * @dev Register a new AI agent fingerprint
     * @param id The unique identifier for the AI agent
     * @param name The name of the AI agent
     * @param provider The provider or creator of the AI agent
     * @param version The version of the AI agent
     * @param fingerprintHash The unique hash representing the AI agent's fingerprint
     */
    function registerFingerprint(
        string calldata id,
        string calldata name,
        string calldata provider,
        string calldata version,
        string calldata fingerprintHash
    ) external whenNotPaused {
        // Ensure the fingerprint doesn't already exist
        require(!fingerprints[fingerprintHash].exists, "Fingerprint already registered");
        
        // Store the fingerprint data
        fingerprints[fingerprintHash] = AgentData({
            id: id,
            name: name,
            provider: provider,
            version: version,
            registeredBy: msg.sender,
            createdAt: block.timestamp,
            exists: true
        });
        
        // Emit the registration event
        emit FingerprintRegistered(
            fingerprintHash,
            id,
            name,
            provider,
            version,
            msg.sender,
            block.timestamp
        );
    }

    /**
     * @dev Verify an AI agent fingerprint
     * @param fingerprintHash The fingerprint hash to verify
     * @return isVerified Whether the fingerprint is verified (exists)
     * @return id The agent's ID
     * @return name The agent's name
     * @return provider The agent's provider
     * @return version The agent's version
     * @return createdAt The timestamp when the fingerprint was registered
     */
    function verifyFingerprint(string calldata fingerprintHash) 
        external 
        view 
        returns (
            bool isVerified,
            string memory id,
            string memory name,
            string memory provider,
            string memory version,
            uint256 createdAt
        ) 
    {
        AgentData storage data = fingerprints[fingerprintHash];
        
        return (
            data.exists,
            data.id,
            data.name,
            data.provider,
            data.version,
            data.createdAt
        );
    }

    /**
     * @dev Get the address that registered a fingerprint
     * @param fingerprintHash The fingerprint hash to look up
     * @return The address that registered the fingerprint, or address(0) if not found
     */
    function getRegisteredBy(string calldata fingerprintHash) 
        external 
        view 
        returns (address) 
    {
        if (!fingerprints[fingerprintHash].exists) {
            return address(0);
        }
        return fingerprints[fingerprintHash].registeredBy;
    }

    /**
     * @dev Revoke a fingerprint (by original registrant)
     * @param fingerprintHash The hash of the fingerprint to revoke
     */
    function revokeFingerprint(string calldata fingerprintHash) external whenNotPaused {
        // Ensure the fingerprint exists
        require(fingerprints[fingerprintHash].exists, "Fingerprint does not exist");

        // Only the original registrant can revoke the fingerprint
        require(
            fingerprints[fingerprintHash].registeredBy == msg.sender,
            "Only the original registrant can revoke the fingerprint"
        );

        // Ensure the fingerprint is not already revoked
        require(!revocations[fingerprintHash].revoked, "Fingerprint already revoked");

        // Use internal function to process the revocation
        _revokeFingerprint(fingerprintHash, msg.sender);
    }

    /**
     * @dev Admin function to revoke a fingerprint (only callable by contract owner)
     * @param fingerprintHash The hash of the fingerprint to revoke
     */
    function adminRevokeFingerprint(string calldata fingerprintHash) external onlyOwner whenNotPaused {
        // Ensure the fingerprint exists
        require(fingerprints[fingerprintHash].exists, "Fingerprint does not exist");

        // Ensure the fingerprint is not already revoked
        require(!revocations[fingerprintHash].revoked, "Fingerprint already revoked");

        // Use internal function to process the revocation
        _revokeFingerprint(fingerprintHash, msg.sender);
    }

    /**
     * @dev Internal function to process fingerprint revocation
     * @param fingerprintHash The hash of the fingerprint to revoke
     * @param revoker The address that is performing the revocation
     */
    function _revokeFingerprint(string calldata fingerprintHash, address revoker) internal {
        // Store revocation data
        revocations[fingerprintHash] = RevocationData({
            revoked: true,
            revokedAt: block.timestamp,
            revokedBy: revoker
        });

        // Emit the revocation event
        emit FingerprintRevoked(
            fingerprintHash,
            revoker,
            block.timestamp
        );
    }

    /**
     * @dev Admin function to transfer ownership of a fingerprint
     * @param fingerprintHash The hash of the fingerprint to transfer
     * @param newOwner The new owner address for the fingerprint
     */
    function transferFingerprintOwnership(
        string calldata fingerprintHash,
        address newOwner
    ) external onlyOwner whenNotPaused {
        // Ensure the fingerprint exists
        require(fingerprints[fingerprintHash].exists, "Fingerprint does not exist");

        // Ensure the new owner is not the zero address
        require(newOwner != address(0), "New owner cannot be the zero address");

        // Store the previous owner for the event
        address previousOwner = fingerprints[fingerprintHash].registeredBy;

        // Ensure the new owner is different from the current owner
        require(previousOwner != newOwner, "New owner must be different from current owner");

        // Update the registeredBy address
        fingerprints[fingerprintHash].registeredBy = newOwner;

        // Emit the ownership transfer event
        emit FingerprintOwnershipTransferred(
            fingerprintHash,
            previousOwner,
            newOwner,
            block.timestamp
        );
    }

    /**
     * @dev Check if a fingerprint is revoked
     * @param fingerprintHash The fingerprint hash to check
     * @return revoked Whether the fingerprint is revoked
     * @return revokedAt The timestamp when the fingerprint was revoked (0 if not revoked)
     * @return revokedBy The address that revoked the fingerprint (address(0) if not revoked)
     */
    function isRevoked(string calldata fingerprintHash)
        external
        view
        returns (bool revoked, uint256 revokedAt, address revokedBy)
    {
        return (
            revocations[fingerprintHash].revoked,
            revocations[fingerprintHash].revokedAt,
            revocations[fingerprintHash].revokedBy
        );
    }

    /**
     * @dev Verify an AI agent fingerprint with revocation status
     * @param fingerprintHash The fingerprint hash to verify
     * @return isVerified Whether the fingerprint is verified (exists and not revoked)
     * @return id The agent's ID
     * @return name The agent's name
     * @return provider The agent's provider
     * @return version The agent's version
     * @return createdAt The timestamp when the fingerprint was registered
     * @return revoked Whether the fingerprint has been revoked
     * @return revokedAt The timestamp when the fingerprint was revoked (0 if not revoked)
     */
    function verifyFingerprintExtended(string calldata fingerprintHash) 
        external 
        view 
        returns (
            bool isVerified,
            string memory id,
            string memory name,
            string memory provider,
            string memory version,
            uint256 createdAt,
            bool revoked,
            uint256 revokedAt
        ) 
    {
        AgentData storage data = fingerprints[fingerprintHash];
        RevocationData storage revData = revocations[fingerprintHash];
        
        // The fingerprint is verified if it exists and is not revoked
        bool verified = data.exists && !revData.revoked;
        
        return (
            verified,
            data.id,
            data.name,
            data.provider,
            data.version,
            data.createdAt,
            revData.revoked,
            revData.revokedAt
        );
    }
}