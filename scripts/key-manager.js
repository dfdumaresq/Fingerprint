#!/usr/bin/env node

/**
 * Key Management CLI Tool
 * 
 * This script provides command-line utilities for managing keys securely
 * according to OWASP key management guidelines.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

// Ensure the dist directory exists
if (!fs.existsSync('./dist/security')) {
  console.error('Error: dist/security directory not found.');
  console.error('Please build the project first with: npm run build');
  process.exit(1);
}

// Import the key management classes
const { 
  KeyManager, 
  KeyType, 
  KeyProviderFactory, 
  KeyProviderType 
} = require('../dist/security');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Prompt for sensitive information securely
function promptSecure(query) {
  return new Promise((resolve) => {
    const stdin = process.openStdin();
    process.stdout.write(query);
    
    // To mute input
    process.stdin.setRawMode(true);
    
    let data = '';
    stdin.on('data', (char) => {
      const c = char.toString('utf8');
      
      // Ctrl+C or Ctrl+D
      if (c === '\u0003' || c === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(1);
      }
      
      // Enter key
      if (c === '\r' || c === '\n') {
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        stdin.removeAllListeners('data');
        resolve(data);
        return;
      }
      
      // Backspace
      if (c === '\u007f') {
        if (data.length > 0) {
          data = data.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      
      // Regular character
      process.stdout.write('*');
      data += c;
    });
  });
}

// Initialize the key manager
async function initializeKeyManager() {
  console.log('Initializing key manager...');
  
  // Check if we have a master password in the environment
  if (!process.env.MASTER_KEY_PASSWORD) {
    const masterPassword = await promptSecure('Enter master key password: ');
    process.env.MASTER_KEY_PASSWORD = masterPassword;
  }
  
  const keyManager = KeyManager.getInstance();
  keyManager.initialize(process.env.MASTER_KEY_PASSWORD, process.env.NODE_ENV);
  
  return keyManager;
}

// List all keys
async function listKeys(keyManager, keyType) {
  console.log(`\nListing all ${keyType} keys:`);
  
  try {
    const keys = await keyManager.listKeys(keyType);
    
    if (keys.length === 0) {
      console.log(`No ${keyType} keys found.`);
      return;
    }
    
    console.log('ID                                      Created                 Expires                  Tags');
    console.log('--------------------------------------------------------------------------------------------');
    
    for (const key of keys) {
      const created = key.createdAt ? new Date(key.createdAt).toLocaleString() : 'N/A';
      const expires = key.expiresAt ? new Date(key.expiresAt).toLocaleString() : 'Never';
      const tags = key.tags ? Object.entries(key.tags).map(([k, v]) => `${k}=${v}`).join(',') : '';
      
      console.log(`${key.keyId.padEnd(40)} ${created.padEnd(22)} ${expires.padEnd(24)} ${tags}`);
    }
  } catch (error) {
    console.error(`Error listing ${keyType} keys:`, error.message);
  }
}

// Add a new key
async function addKey(keyManager, keyType) {
  console.log(`\nAdding a new ${keyType} key:`);
  
  let key = '';
  
  // For wallet and deployment keys, provide the option to generate a new key
  if (keyType === KeyType.WALLET || keyType === KeyType.DEPLOYMENT) {
    const generateKey = await new Promise((resolve) => {
      rl.question('Generate new key? (y/n): ', (answer) => {
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
    
    if (generateKey) {
      // Generate a new private key
      console.log('Generating a new private key...');
      const privateKey = '0x' + crypto.randomBytes(32).toString('hex');
      key = privateKey;
    }
  }
  
  // If key is not generated or for other key types, ask for the key
  if (!key) {
    key = await promptSecure('Enter the key: ');
  }
  
  try {
    // Get metadata for the key
    const keyId = await new Promise((resolve) => {
      rl.question('Key ID (leave blank for auto-generated): ', (answer) => {
        resolve(answer || null);
      });
    });
    
    const description = await new Promise((resolve) => {
      rl.question('Description: ', (answer) => {
        resolve(answer);
      });
    });
    
    const expiresInDays = await new Promise((resolve) => {
      rl.question('Expires in days (0 for never): ', (answer) => {
        resolve(parseInt(answer, 10) || 0);
      });
    });
    
    const metadata = {
      keyId: keyId || undefined,
      tags: {
        keyType: keyType.toString(),
        description: description || 'Added via CLI'
      }
    };
    
    if (expiresInDays > 0) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
      metadata.expiresAt = expiresAt;
    }
    
    // Store the key
    const storedKeyId = await keyManager.storeKey(keyType, key, metadata);
    console.log(`Key stored successfully with ID: ${storedKeyId}`);
    
    return storedKeyId;
  } catch (error) {
    console.error('Error adding key:', error.message);
    return null;
  }
}

// Delete a key
async function deleteKey(keyManager, keyType) {
  console.log(`\nDeleting a ${keyType} key:`);
  
  try {
    // List available keys
    await listKeys(keyManager, keyType);
    
    const keyId = await new Promise((resolve) => {
      rl.question('Enter the ID of the key to delete: ', (answer) => {
        resolve(answer);
      });
    });
    
    if (!keyId) {
      console.log('Operation cancelled.');
      return;
    }
    
    const confirm = await new Promise((resolve) => {
      rl.question(`Are you sure you want to delete key ${keyId}? (y/n): `, (answer) => {
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
    
    if (!confirm) {
      console.log('Operation cancelled.');
      return;
    }
    
    const result = await keyManager.deleteKey(keyType, keyId);
    
    if (result) {
      console.log(`Key ${keyId} deleted successfully.`);
    } else {
      console.log(`Key ${keyId} not found.`);
    }
  } catch (error) {
    console.error('Error deleting key:', error.message);
  }
}

// Rotate a key
async function rotateKey(keyManager, keyType) {
  console.log(`\nRotating a ${keyType} key:`);
  
  try {
    // List available keys
    await listKeys(keyManager, keyType);
    
    const keyId = await new Promise((resolve) => {
      rl.question('Enter the ID of the key to rotate: ', (answer) => {
        resolve(answer);
      });
    });
    
    if (!keyId) {
      console.log('Operation cancelled.');
      return;
    }
    
    const confirm = await new Promise((resolve) => {
      rl.question(`Are you sure you want to rotate key ${keyId}? (y/n): `, (answer) => {
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
    
    if (!confirm) {
      console.log('Operation cancelled.');
      return;
    }
    
    const newKeyId = await keyManager.rotateKey(keyType, keyId);
    console.log(`Key ${keyId} rotated successfully. New key ID: ${newKeyId}`);
  } catch (error) {
    console.error('Error rotating key:', error.message);
  }
}

// Migrate keys from environment to secure storage
async function migrateKeys(keyManager) {
  console.log('\nMigrating keys from environment variables to secure storage:');
  
  try {
    // Check for private keys in the environment
    if (process.env.PRIVATE_KEY) {
      console.log('Found PRIVATE_KEY in environment variables.');
      
      const confirm = await new Promise((resolve) => {
        rl.question('Do you want to migrate this key to secure storage? (y/n): ', (answer) => {
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
      });
      
      if (confirm) {
        const keyId = await keyManager.storeKey(
          KeyType.DEPLOYMENT,
          process.env.PRIVATE_KEY,
          {
            keyId: 'migrated_deployment_key',
            tags: {
              keyType: KeyType.DEPLOYMENT.toString(),
              description: 'Migrated from environment variable',
              source: 'PRIVATE_KEY',
              migrated_at: new Date().toISOString()
            }
          }
        );
        
        console.log(`Deployment key migrated successfully with ID: ${keyId}`);
        console.log('IMPORTANT: Remove the PRIVATE_KEY from your .env file now!');
      }
    } else {
      console.log('No PRIVATE_KEY found in environment variables.');
    }
    
    // Check for other keys to migrate
    // Add migration for other key types here
    
    console.log('Migration complete.');
  } catch (error) {
    console.error('Error migrating keys:', error.message);
  }
}

// Main menu
async function mainMenu() {
  try {
    const keyManager = await initializeKeyManager();
    
    while (true) {
      console.log('\n=======================================');
      console.log('       SECURE KEY MANAGEMENT CLI       ');
      console.log('=======================================');
      console.log('1. List Keys');
      console.log('2. Add New Key');
      console.log('3. Delete Key');
      console.log('4. Rotate Key');
      console.log('5. Migrate Keys from Environment');
      console.log('6. Exit');
      console.log('=======================================');
      
      const choice = await new Promise((resolve) => {
        rl.question('Enter your choice (1-6): ', (answer) => {
          resolve(answer);
        });
      });
      
      switch (choice) {
        case '1': // List Keys
          const keyTypeForList = await selectKeyType();
          if (keyTypeForList) {
            await listKeys(keyManager, keyTypeForList);
          }
          break;
        
        case '2': // Add New Key
          const keyTypeForAdd = await selectKeyType();
          if (keyTypeForAdd) {
            await addKey(keyManager, keyTypeForAdd);
          }
          break;
        
        case '3': // Delete Key
          const keyTypeForDelete = await selectKeyType();
          if (keyTypeForDelete) {
            await deleteKey(keyManager, keyTypeForDelete);
          }
          break;
        
        case '4': // Rotate Key
          const keyTypeForRotate = await selectKeyType();
          if (keyTypeForRotate) {
            await rotateKey(keyManager, keyTypeForRotate);
          }
          break;
        
        case '5': // Migrate Keys
          await migrateKeys(keyManager);
          break;
        
        case '6': // Exit
          console.log('Exiting...');
          rl.close();
          return;
        
        default:
          console.log('Invalid choice. Please try again.');
      }
    }
  } catch (error) {
    console.error('An error occurred:', error);
    rl.close();
  }
}

// Helper to select a key type
async function selectKeyType() {
  console.log('\nSelect Key Type:');
  console.log('1. Deployment Key');
  console.log('2. Wallet Key');
  console.log('3. Signing Key');
  console.log('4. API Key');
  console.log('5. Back to Main Menu');
  
  const choice = await new Promise((resolve) => {
    rl.question('Enter your choice (1-5): ', (answer) => {
      resolve(answer);
    });
  });
  
  switch (choice) {
    case '1': return KeyType.DEPLOYMENT;
    case '2': return KeyType.WALLET;
    case '3': return KeyType.SIGNING;
    case '4': return KeyType.API;
    case '5': return null;
    default:
      console.log('Invalid choice. Please try again.');
      return await selectKeyType();
  }
}

// Start the application
mainMenu().catch(console.error);