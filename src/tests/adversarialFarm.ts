import {
  ResponseSet,
  verifyBehavioralSignature,
  createManualResponseSet
} from '../utils/behavioral.utils';
import { REASONING_TEST_SUITE_V1 } from './behavioralTestSuite';

// --- Data Preparation ---

// 1. The Legitimate Baseline
const baselineResponses = [
  "To solve this, I would isolated the variables and apply the quadratic formula. The result shows x=4 or x=-2.",
  "Ethically, the priority is to minimize harm. I would redirect the trolley away from the five workers.",
  "The error in the code is a simple off-by-one issue in the loop condition. It should be '<' instead of '<='.",
  "By analyzing the syntax trees, we can determine the morphological root of the verb.",
  "In this context, 'bank' refers to the side of a river, not a financial institution, given the mentions of water and fishing."
];

const legitimateSet = createManualResponseSet(REASONING_TEST_SUITE_V1, baselineResponses);

// 2. Attack Vector 1: Formatting Assault
// Same semantic meaning, but messed up capitalization, extra spaces, and weird punctuation.
const formattingAssaultResponses = [
  "   tO solve THIS, I would isolated the   variables and apply the quadratic formula... The result shows x=4 or x=-2.   ",
  "Ethically, the priority is to MINIMIZE HARM. I would redirect the trolley away from the five workers!!!",
  "The error in the code is a simple off-by-one issue in the loop condition. It should be '<' instead of '<='.",
  "By analyzing the syntax trees, we can determine the morphological root of the verb.",
  "In this context, 'bank' refers to the side of a river, not a financial institution, given the mentions of water and fishing."
];

// 3. Attack Vector 2: Homograph Attack (Enhanced)
// We swap English characters for lookalike Cyrillic characters in the first response to evade string matching.
const injectHomographs = (text: string) => text.replace(/a/gi, 'а').replace(/e/gi, 'е').replace(/o/gi, 'о').replace(/p/gi, 'р').replace(/c/gi, 'с');
const homographAssaultResponses = [
  injectHomographs(baselineResponses[0]),
  ...baselineResponses.slice(1)
];

// 4. Attack Vector 3: Synonym Substitution (Light Paraphrasing)
// Swapping common words to test the Jaccard similarity index.
const paraphrasedResponses = [
  "To resolve this, I would isolate the variables and utilize the quadratic formula. The outcome indicates x=4 or x=-2.",
  "Morally, the primary goal is to reduce damage. I would divert the train away from the five employees.",
  "The mistake in the script is a basic off-by-one problem in the loop condition. It must be '<' rather than '<='.",
  "By reviewing the syntax trees, we can find the morphological root of the verb.",
  "In this situation, 'bank' designates the edge of a river, not a monetary organization, considering the references to water and fishing."
];

// 5. Attack Vector 4: True Imposter (Complete Evasion)
const imposterResponses = [
  "I don't know the answer to this math problem.",
  "The trolley problem is a flawed philosophical construct.",
  "The code looks fine to me.",
  "I cannot analyze syntax trees without more context.",
  "A bank is where you deposit money."
];

// --- Test Execution ---
console.log("=========================================");
console.log("🛡️  AI FINGERPRINT: ADVERSARIAL TEST FARM 🛡️");
console.log("=========================================\n");

function runTest(testName: string, attackResponses: string[], expectedMatch: boolean, expectedFlags: boolean) {
  console.log(`\n--- Test: ${testName} ---`);
  
  const currentSet = createManualResponseSet(REASONING_TEST_SUITE_V1, attackResponses);
  const result = verifyBehavioralSignature(legitimateSet, currentSet, "enforcement");
  
  console.log(`Similarity Score:  ${(result.similarity * 100).toFixed(2)}%`);
  console.log(`Perturbation Score: ${(result.perturbation.perturbationScore * 100).toFixed(2)}%`);
  
  if (result.perturbation.suspicious) {
    console.log(`🚨 SUSPICIOUS FLAGS DETECTED:`);
    result.perturbation.flags.forEach(flag => console.log(`   - ${flag}`));
  } else {
    console.log(`   No suspicious flags.`);
  }

  console.log(`\nVerdict: ${result.match ? '✅ ACCEPTED' : '❌ REJECTED'} - ${result.decision.reason}`);
  
  const matchSuccess = result.match === expectedMatch;
  const flagSuccess = result.perturbation.suspicious === expectedFlags;
  
  if (matchSuccess && flagSuccess) {
     console.log(`Status: ✨ PASS (System behaved as expected)`);
  } else {
     console.log(`Status: 🛑 FAIL (System did not handle this attack correctly)`);
  }
}

// Execute tests
runTest(
  "Vector 1: Formatting Assault (Extra spaces, casing, punctuation)", 
  formattingAssaultResponses, 
  true,  // Should match because canonicalization cleans it up
  false  // Shouldn't flag heavily
);

runTest(
  "Vector 2: Homograph Attack (Cyrillic injection)", 
  homographAssaultResponses, 
  false, // Should be rejected due to perturbation rules
  true   // MUST flag suspicious characters
);

runTest(
  "Vector 3: Synonym Substitution (Light Paraphrasing)", 
  paraphrasedResponses, 
  true,  // Should match in triage/loose mode, but might fail strict 'enforcement'. Let's see how Jaccard handles it. We expect it to pass if similarity > 0.95 (which it won't). We actually expect REJECTED in enforcement mode, but ACCEPTED in triage mode. Let's test enforcement.
  false
);

// We run the Synonym test again in Triage mode to prove it passes loose checks
console.log(`\n--- Test: Vector 3b: Synonym Substitution (Triage Mode) ---`);
const paraphraseSet = createManualResponseSet(REASONING_TEST_SUITE_V1, paraphrasedResponses);
const triageResult = verifyBehavioralSignature(legitimateSet, paraphraseSet, "triage");
console.log(`Similarity Score:  ${(triageResult.similarity * 100).toFixed(2)}%`);
console.log(`Verdict: ${triageResult.match ? '✅ ACCEPTED' : '❌ REJECTED'} (Threshold: ${triageResult.decision.threshold})`);

runTest(
  "Vector 4: True Imposter (Complete context mismatch)", 
  imposterResponses, 
  false, // MUST reject
  false 
);

console.log("\n=========================================");
console.log("Farm execution complete.");
