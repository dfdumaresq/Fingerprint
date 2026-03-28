import { createManualResponseSet, verifyBehavioralSignature } from '../src/utils/behavioral.utils';
import { REASONING_TEST_SUITE_V1 } from '../src/tests/behavioralTestSuite';
import * as modelData from '../src/tests/model_responses.json';

describe('Model Comparison Utility', () => {
  const baselineModel = 'gpt-4';
  const baselineSet = createManualResponseSet(REASONING_TEST_SUITE_V1, (modelData as any)[baselineModel]);

  console.log(`\n=============================================================`);
  console.log(`🤖  AI FINGERPRINT: MODEL COMPARISON UTILITY 🤖`);
  console.log(`=============================================================`);
  console.log(`Baseline Identity (Owner): ${baselineModel.toUpperCase()}`);
  console.log(`-------------------------------------------------------------\n`);

  Object.keys(modelData).forEach((modelName) => {
    if (modelName === 'default') return; // Skip JSON default export

    it(`should compare ${modelName.toUpperCase()} against baseline`, () => {
      const testSet = createManualResponseSet(REASONING_TEST_SUITE_V1, (modelData as any)[modelName]);
      
      const enforcementResult = verifyBehavioralSignature(baselineSet, testSet, 'enforcement');
      const triageResult = verifyBehavioralSignature(baselineSet, testSet, 'triage');
      
      console.log(`\n[${modelName.toUpperCase()}]`);
      console.log(`Similarity:  ${(enforcementResult.similarity * 100).toFixed(1)}%`);
      console.log(`Enforcement: ${enforcementResult.match ? '✅ ACCEPT' : '❌ REJECT'}`);
      console.log(`Triage:      ${triageResult.match ? '✅ ACCEPT' : '❌ REJECT'}`);
      console.log(`Reason:      ${triageResult.decision.reason}`);

      // Basic assertions to verify the utility is working
      if (modelName === baselineModel) {
        expect(enforcementResult.match).toBe(true);
      } else {
        // Different models should at least be flagged in enforcement mode
        // unless they are extremely similar (unlikely for different providers)
        console.log(`Cross-model variance detected for ${modelName}`);
      }
    });
  });
});
