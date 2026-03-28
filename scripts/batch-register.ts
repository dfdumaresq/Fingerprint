import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CONTRACT_ADDRESS = process.env.REACT_APP_SEPOLIA_CONTRACT_ADDRESS;
const RPC_URL = process.env.REACT_APP_SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!CONTRACT_ADDRESS || !RPC_URL || !PRIVATE_KEY) {
    console.error('Missing environment variables. Check .env');
    process.exit(1);
}

const ABI = [
    "function registerFingerprint(string id, string name, string provider, string version, string fingerprintHash) external",
    "function registerBehavioralTrait(string fingerprintHash, string traitHash, string traitVersion) external",
    "function verifyFingerprint(string fingerprintHash) external view returns (bool isVerified, string id, string name, string provider, string version, uint256 createdAt)"
];

async function main() {
    const csvPath = process.argv[2];
    if (!csvPath) {
        console.error('Usage: npm run batch-register <path-to-csv>');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY!, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS!, ABI, wallet);

    console.log(`\n=============================================================`);
    console.log(`🚀 AI FINGERPRINT: BATCH REGISTRATION UTILITY 🚀`);
    console.log(`=============================================================`);
    console.log(`Target Contract: ${CONTRACT_ADDRESS}`);
    console.log(`Account: ${wallet.address}\n`);

    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const headers = lines[0].split(',').map(h => h.trim());

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const agent: any = {};
        headers.forEach((h, idx) => agent[h] = values[idx]);

        console.log(`[Row ${i}] Processing: ${agent.name} (${agent.id})`);

        try {
            // 1. Register Fingerprint
            console.log(`   - Registering fingerprint: ${agent.fingerprintHash.substring(0, 10)}...`);
            const tx = await contract.registerFingerprint(
                agent.id,
                agent.name,
                agent.provider,
                agent.version || '1.0.0',
                agent.fingerprintHash
            );
            await tx.wait(1);
            console.log(`   ✅ Fingerprint registered. TX: ${tx.hash}`);

            // 2. Register Behavioral Trait (Optional)
            if (agent.behavioralTraitHash && agent.behavioralTraitHash !== 'none') {
                console.log(`   - Registering behavioral trait: ${agent.behavioralTraitHash.substring(0, 10)}...`);
                const traitTx = await contract.registerBehavioralTrait(
                    agent.fingerprintHash,
                    agent.behavioralTraitHash,
                    agent.traitVersion || 'reasoning-v1.0'
                );
                await traitTx.wait(1);
                console.log(`   ✅ Behavioral trait registered. TX: ${traitTx.hash}`);
            }

        } catch (err: any) {
            if (err.message.includes('already registered')) {
                console.log(`   ⚠️ Skipping: Agent already exists on-chain.`);
            } else {
                console.error(`   ❌ Failed: ${err.shortMessage || err.message}`);
            }
        }
        console.log('-------------------------------------------------------------');
    }

    console.log(`\n🏁 Batch Processing Complete.`);
}

main().catch(console.error);
