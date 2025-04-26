# AI Agent Fingerprinting System

A blockchain-based system for registering and verifying the identity of AI agents using unique fingerprints.

## Overview

This application allows users to:

1. **Register AI Agent Fingerprints**: Generate and store unique identifiers for AI agents on the blockchain
2. **Verify AI Agent Fingerprints**: Confirm the authenticity of an AI agent by checking its fingerprint against the blockchain record

## Technologies Used

- React with TypeScript for the frontend
- Ethers.js for blockchain integration
- Solidity for smart contracts
- Webpack for bundling

## Prerequisites

- Node.js (v16+)
- npm or yarn
- MetaMask or another Ethereum wallet browser extension

## Installation

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd Fingerprint
npm install
```

## Smart Contract Deployment

1. Install Hardhat (if not already installed):
   ```bash
   npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
   ```

2. Initialize Hardhat and deploy the contract:
   ```bash
   npx hardhat init
   npx hardhat compile
   npx hardhat deploy --network <your-network>
   ```

3. Update the contract address in `src/App.tsx` with your deployed contract address.

## Configuration

Before running the application, update the following in `src/App.tsx`:

```typescript
const blockchainConfig: BlockchainConfig = {
  networkUrl: 'https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY', // Replace with your provider URL
  chainId: 11155111, // Use appropriate network ID
  contractAddress: 'YOUR_DEPLOYED_CONTRACT_ADDRESS' // Replace with your contract address
};
```

## Running the Application

Start the development server:

```bash
npm start
```

The application will be available at http://localhost:3000.

## Usage

1. **Connect Your Wallet**:
   - Click "Connect Wallet" and approve the connection in your wallet extension

2. **Register an AI Agent Fingerprint**:
   - Fill in the agent details (ID, name, provider, version)
   - Click "Generate" to create a unique fingerprint hash based on the agent details, or manually input a hash
   - Submit the form to register on the blockchain

3. **Verify an AI Agent Fingerprint**:
   - Enter a fingerprint hash
   - Click "Verify" to check if it exists on the blockchain
   - View the registration details if verified

The fingerprint hash is generated using the keccak256 algorithm, combining the agent's ID, name, provider, version, and a timestamp to ensure uniqueness.

## Blockchain Networks

This application can be configured to work with:

- Ethereum Mainnet
- Ethereum Testnets (Sepolia, Goerli)
- Layer 2 solutions (Arbitrum, Optimism)
- Other EVM-compatible chains

## License

[MIT License](LICENSE)