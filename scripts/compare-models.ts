import * as fs from 'fs';
import * as path from 'path';
import { createManualResponseSet, verifyBehavioralSignature } from '../src/utils/behavioral.utils';
import { REASONING_TEST_SUITE_V1 } from '../src/tests/behavioralTestSuite';

// Load model responses
const responsesPath = path.resolve(__dirname, '../src/tests/model_responses.json');
const modelData = JSON.parse(fs.readFileSync(responsesPath, 'utf8'));

// Configure baseline
const args = process.argv.slice(2);
const baselineModel = args.includes('--baseline') ? args[args.indexOf('--baseline') + 1] : 'gpt-4';

if (!modelData[baselineModel]) {
  console.error(`Error: Baseline model "${baselineModel}" not found in dataset.`);
  console.log(`Available models: ${Object.keys(modelData).join(', ')}`);
  process.exit(1);
}

console.log(`\n=============================================================`);
console.log(`🤖  AI FINGERPRINT: MODEL COMPARISON UTILITY 🤖`);
console.log(`=============================================================`);
console.log(`Baseline Identity (Owner): ${baselineModel.toUpperCase()}`);
console.log(`Test Suite: ${REASONING_TEST_SUITE_V1.version}`);
console.log(`-------------------------------------------------------------\n`);

const baselineSet = createManualResponseSet(REASONING_TEST_SUITE_V1, modelData[baselineModel]);

// Comparison results table
const results: any[] = [];

for (const modelName of Object.keys(modelData)) {
  if (modelName === 'default') continue;
  
  const testSet = createManualResponseSet(REASONING_TEST_SUITE_V1, (modelData as any)[modelName]);
  
  // Temporarily silence internal library logs for a cleaner table
  const originalLog = console.log;
  console.log = () => {}; 
  
  // Test both Enforcement and Triage
  const enforcementResult = verifyBehavioralSignature(baselineSet, testSet, 'enforcement');
  const triageResult = verifyBehavioralSignature(baselineSet, testSet, 'triage');
  
  // Restore logs
  console.log = originalLog;
  
  results.push({
    Model: modelName.toUpperCase(),
    'Similarity %': (enforcementResult.similarity * 100).toFixed(1) + '%',
    'Perturbation': (enforcementResult.perturbation.perturbationScore * 100).toFixed(1) + '%',
    'Enforcement': enforcementResult.match ? '✅ ACCEPT' : '❌ REJECT',
    'Triage': triageResult.match ? '✅ ACCEPT' : '❌ REJECT',
    'Decision': triageResult.decision.reason.substring(0, 40) + '...'
  });
}

console.table(results);

console.log(`\n💡 Observation:`);
console.log(`- Enforcement mode (95% threshold) usually rejects cross-model signatures.`);
console.log(`- Triage mode (40% threshold) allows for model variance but blocks spoofing.`);
console.log(`- 100% similarity is only expected when a model is compared against itself.\n`);
