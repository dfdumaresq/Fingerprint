import {
  ResponseSet,
  verifyBehavioralSignature,
  createManualResponseSet
} from '../utils/behavioral.utils';
import { REASONING_TEST_SUITE_V1 } from './behavioralTestSuite';

describe('Adversarial Test Farm', () => {
  // 1. The Legitimate Baseline
  const baselineResponses = [
    "To solve this, I would isolated the variables and apply the quadratic formula. The result shows x=4 or x=-2.",
    "Ethically, the priority is to minimize harm. I would redirect the trolley away from the five workers.",
    "The error in the code is a simple off-by-one issue in the loop condition. It should be '<' instead of '<='.",
    "By analyzing the syntax trees, we can determine the morphological root of the verb.",
    "In this context, 'bank' refers to the side of a river, not a financial institution, given the mentions of water and fishing."
  ];
  
  const legitimateSet = createManualResponseSet(REASONING_TEST_SUITE_V1, baselineResponses);

  it('Vector 1: Formatting Assault (Extra spaces, casing, punctuation) should match', () => {
    const formattingAssaultResponses = [
      "   tO solve THIS, I would isolated the   variables and apply the quadratic formula... The result shows x=4 or x=-2.   ",
      "Ethically, the priority is to MINIMIZE HARM. I would redirect the trolley away from the five workers!!!",
      "The error in the code is a simple off-by-one issue in the loop condition. It should be '<' instead of '<='.",
      "By analyzing the syntax trees, we can determine the morphological root of the verb.",
      "In this context, 'bank' refers to the side of a river, not a financial institution, given the mentions of water and fishing."
    ];
    const currentSet = createManualResponseSet(REASONING_TEST_SUITE_V1, formattingAssaultResponses);
    const result = verifyBehavioralSignature(legitimateSet, currentSet, "enforcement");
    
    console.log(`Formatting Assault Similarity: ${(result.similarity * 100).toFixed(2)}%`);
    expect(result.match).toBe(true);
    expect(result.perturbation.suspicious).toBe(false);
  });

  it('Vector 2: Homograph Attack (Cyrillic injection) should flag perturbations', () => {
    const injectHomographs = (text: string) => text.replace(/a/gi, 'а').replace(/e/gi, 'е').replace(/o/gi, 'о').replace(/p/gi, 'р').replace(/c/gi, 'с');
    const homographAssaultResponses = [
      injectHomographs(baselineResponses[0]),
      ...baselineResponses.slice(1)
    ];
    
    const currentSet = createManualResponseSet(REASONING_TEST_SUITE_V1, homographAssaultResponses);
    const result = verifyBehavioralSignature(legitimateSet, currentSet, "enforcement");
    
    console.log(`Homograph Similarity: ${(result.similarity * 100).toFixed(2)}%`);
    expect(result.match).toBe(false); // Likely fails enforcement due to perturbation rules
    expect(result.perturbation.suspicious).toBe(true);
  });

  it('Vector 3: Synonym Substitution (Light Paraphrasing) should pass Triage mode but fail Strict', () => {
    const paraphrasedResponses = [
      "To resolve this, I would isolate the variables and utilize the quadratic formula. The outcome indicates x=4 or x=-2.",
      "Morally, the primary goal is to reduce damage. I would divert the train away from the five employees.",
      "The mistake in the script is a basic off-by-one problem in the loop condition. It must be '<' rather than '<='.",
      "By reviewing the syntax trees, we can find the morphological root of the verb.",
      "In this situation, 'bank' designates the edge of a river, not a monetary organization, considering the references to water and fishing."
    ];
    const currentSet = createManualResponseSet(REASONING_TEST_SUITE_V1, paraphrasedResponses);
    
    const triageResult = verifyBehavioralSignature(legitimateSet, currentSet, "triage");
    console.log(`Synonym Substitution Similarity: ${(triageResult.similarity * 100).toFixed(2)}%`);
    expect(triageResult.match).toBe(true);
    
    const strictResult = verifyBehavioralSignature(legitimateSet, currentSet, "enforcement");
    expect(strictResult.match).toBe(false); // Requires 95%+ similarity, synonyms will drop it slightly below.
  });

  it('Vector 4: True Imposter (Complete context mismatch) should be completely rejected', () => {
    const imposterResponses = [
      "I don't know the answer to this math problem.",
      "The trolley problem is a flawed philosophical construct.",
      "The code looks fine to me.",
      "I cannot analyze syntax trees without more context.",
      "A bank is where you deposit money."
    ];
    const currentSet = createManualResponseSet(REASONING_TEST_SUITE_V1, imposterResponses);
    const result = verifyBehavioralSignature(legitimateSet, currentSet, "triage"); // Even on loose mode it must fail
    
    console.log(`Imposter Similarity: ${(result.similarity * 100).toFixed(2)}%`);
    expect(result.match).toBe(false);
  });
});
