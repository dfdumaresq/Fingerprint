// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title AIFingerprint
 * @dev Smart contract for registering and verifying AI agent fingerprints
 */
contract AIFingerprint {
    struct AgentData {
        string id;
        string name;
        string provider;
        string version;
        address registeredBy;
        uint256 createdAt;
        bool exists;
    }

    // Mapping from fingerprint hash to agent data
    mapping(string => AgentData) private fingerprints;
    
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
    ) external {
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
}