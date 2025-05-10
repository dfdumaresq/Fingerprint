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
- Hardhat for contract deployment
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

## Configuration

1. Copy the example environment file and update it with your values:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file with your:
   - Ethereum wallet private key for deployment
   - Alchemy API key for accessing the Ethereum network

   ```
   PRIVATE_KEY=your_wallet_private_key_here
   SEPOLIA_URL=https://eth-sepolia.g.alchemy.com/v2/your-alchemy-api-key
   ```

3. After deploying the contract, update the `blockchainConfig` in `src/App.tsx` with your:
   - Alchemy API URL
   - Deployed contract address

## Smart Contract Deployment

1. Compile the contract:
   ```bash
   npm run compile
   ```

2. Deploy to Sepolia testnet:
   ```bash
   npm run deploy:sepolia
   ```

3. Deploy to a local Hardhat network (for development):
   ```bash
   npm run deploy:local
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
   - Optionally enable EIP-712 typed data signatures for enhanced security
   - Submit the form to register on the blockchain
   - [View Registration Example](docs/Register%20Agent%20Fingerprint.pdf)

3. **Verify an AI Agent Fingerprint**:
   - Enter a fingerprint hash
   - Click "Verify" to check if it exists on the blockchain
   - View the registration details if verified
   - [View Verification Example](docs/Verify%20Agent%20Fingerprint.pdf)

The fingerprint hash is generated using the keccak256 algorithm, combining the agent's ID, name, provider, version, and a timestamp to ensure uniqueness.

### EIP-712 Typed Data Signatures

This project also supports EIP-712 typed data signatures for enhanced security and structure:

- **Structured Data**: EIP-712 provides a structured format with explicit typing for all fields
- **Human-Readable Format**: Makes signatures more interpretable and prevents signature replay attacks
- **Domain Separation**: Includes domain information to prevent cross-application signature reuse
- **Optional Feature**: Can be enabled via a checkbox during agent registration

## Blockchain Networks

This application can be configured to work with:

- Ethereum Mainnet
- Ethereum Testnets (Sepolia, Goerli)
- Layer 2 solutions (Arbitrum, Optimism)
- Other EVM-compatible chains

## AI Assistance Attribution

This project was built with assistance from Claude AI (Anthropic). The AI contribution has been fingerprinted and registered on the Sepolia testnet blockchain with the following details:

- **ID**: AI Agent Fingerprinting System Code Assistant
- **AI**: Claude (Anthropic)
- **Version**: Claude-3-7-Sonnet-20250219
- **Fingerprint Hash**: `0x59bba0ed5a7d4a5ba2c3ecad48fa376f9383b834ad28b581a5ea97e11f3d1385`

### Verifying the Fingerprint

To verify this fingerprint:

1. Ensure you have MetaMask connected to the Sepolia testnet
2. Go to the "Verify Fingerprint" tab in the application
3. Enter the hash: `0x59bba0ed5a7d4a5ba2c3ecad48fa376f9383b834ad28b581a5ea97e11f3d1385`
4. Click "Verify" to see the registration details

Alternatively, you can verify using Etherscan:

1. Visit the [Sepolia Etherscan](https://sepolia.etherscan.io/)
2. Navigate to the contract address: `0x92eF65Ba802b38F3A87a3Ae292a4624FA3040930`
3. Go to the "Read Contract" tab
4. Call the `verifyFingerprint` function with the hash above

This verification process ensures the authenticity of the AI assistance used in this project, regardless of any UI modifications in forks.

## License

[MIT License](LICENSE)