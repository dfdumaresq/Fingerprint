require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Create exports object to hold the secure key management
const securityExports = {};

// Load the secure key management
try {
  // We'll try to use the compiled files first
  const { KeyProviderFactory, KeyProviderType } = require("./dist/security/KeyProviderFactory");
  const { KeyManager, KeyType } = require("./dist/security/KeyManager");
  
  // Initialize the key manager
  const keyManager = KeyManager.getInstance();
  keyManager.initialize(process.env.MASTER_KEY_PASSWORD, process.env.NODE_ENV);
  
  // Store for use in this file
  securityExports.keyManager = keyManager;
  securityExports.KeyType = KeyType;
  securityExports.isSecure = true;
  
  console.log("Secure key management loaded successfully.");
} catch (error) {
  console.warn("Could not load secure key management. Some features may be disabled.");
  console.warn(error.message);
  console.warn("To enable secure key management, run: npm run build");
  
  // Provide a fallback for deployments
  securityExports.keyManager = {
    getKey: async () => process.env.PRIVATE_KEY,
    storeKey: async () => "dummy-key-id"
  };
  securityExports.KeyType = { DEPLOYMENT: "deployment" };
  securityExports.isSecure = false;
}

// Asynchronously get the deployment private key
async function getDeploymentKey() {
  const { keyManager, KeyType, isSecure } = securityExports;
  
  try {
    // First try to get the deployment key from the key manager
    return await keyManager.getKey(KeyType.DEPLOYMENT, 'hardhat_deployment');
  } catch (error) {
    console.warn('Error getting deployment key from key manager:', error.message);
    console.warn('Falling back to environment variable PRIVATE_KEY');
    
    // If an error occurs (e.g., key not found), fall back to env var
    if (process.env.PRIVATE_KEY) {
      // Store the key for future use if we have a master password and key manager is fully functional
      if (process.env.MASTER_KEY_PASSWORD && isSecure) {
        try {
          await keyManager.storeKey(
            KeyType.DEPLOYMENT, 
            process.env.PRIVATE_KEY,
            {
              keyId: 'hardhat_deployment',
              tags: {
                keyType: KeyType.DEPLOYMENT.toString(),
                description: 'Hardhat deployment key from environment variable'
              }
            }
          );
          console.log('Stored deployment key from environment variable in secure key storage');
        } catch (storeError) {
          console.warn('Failed to store deployment key:', storeError.message);
        }
      }
      
      return process.env.PRIVATE_KEY;
    }
    
    console.warn('No deployment key available. Deployments will fail.');
    return null;
  }
}

// Function to get accounts asynchronously
async function getAccounts() {
  const deploymentKey = await getDeploymentKey();
  return deploymentKey ? [deploymentKey] : [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    // Local development network
    hardhat: {
      chainId: 31337
    },
    // Sepolia testnet configuration
    sepolia: {
      url: process.env.SEPOLIA_URL || "https://eth-sepolia.g.alchemy.com/v2/your-api-key",
      accounts: {
        mnemonic: process.env.MNEMONIC || '',
        // We use a getter function to fetch keys securely
        async lazyFetchAccount() {
          return await getAccounts();
        }
      },
      chainId: 11155111
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};