// Scripts for deploying the AIFingerprint smart contract
let KeyManager, KeyType;

// Try to load the secure key management
try {
  // First try the compiled version (dist)
  ({ KeyManager, KeyType } = require("../dist/security"));
} catch (error) {
  try {
    // Fall back to source version using ts-node
    require("ts-node").register();
    ({ KeyManager, KeyType } = require("../src/security"));
  } catch (fallbackError) {
    console.warn("Could not load secure key management:", fallbackError.message);
    // Provide fallbacks for basic functionality
    KeyManager = {
      getInstance: () => ({
        storeKey: async () => console.log("Key storage not available")
      })
    };
    KeyType = { DEPLOYMENT: "deployment" };
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  try {
    // Store deployment information in key manager for auditing
    const keyManager = KeyManager.getInstance();
    await keyManager.storeKey(
      KeyType.DEPLOYMENT,
      deployer.address,
      {
        keyId: `deployment_${Date.now()}`,
        tags: {
          keyType: KeyType.DEPLOYMENT.toString(),
          description: 'Contract deployment record',
          network: network.name,
          deployer: deployer.address,
          timestamp: new Date().toISOString(),
          contractName: 'AIFingerprint'
        }
      }
    );

    console.log('Recorded deployment information in secure storage');
  } catch (error) {
    console.warn('Failed to record deployment information:', error.message);
    // Continue with deployment regardless
  }

  // Deploy the AIFingerprint contract
  const AIFingerprint = await ethers.getContractFactory("AIFingerprint");
  const contract = await AIFingerprint.deploy();

  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log("AIFingerprint contract deployed to:", contractAddress);
  console.log("Update this address in your src/App.tsx file to connect to this contract");

  try {
    // Store contract address in key manager for future reference
    const keyManager = KeyManager.getInstance();
    await keyManager.storeKey(
      KeyType.DEPLOYMENT,
      contractAddress,
      {
        keyId: `contract_${network.name}_${Date.now()}`,
        tags: {
          keyType: KeyType.DEPLOYMENT.toString(),
          description: 'Contract address record',
          network: network.name,
          deployer: deployer.address,
          timestamp: new Date().toISOString(),
          contractName: 'AIFingerprint',
          contractAddress: contractAddress
        }
      }
    );

    console.log('Recorded contract address in secure storage');
  } catch (error) {
    console.warn('Failed to record contract address:', error.message);
    // This is non-critical, so we continue
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });