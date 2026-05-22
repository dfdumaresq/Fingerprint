export interface FeatureMetadata {
  name: string;
  description: string;
  category: 'Critical' | 'Clinical' | 'Cognitive' | 'Structural';
  priority: 'High' | 'Medium' | 'Low';
}

export const curatedFeatures: Record<number, FeatureMetadata> = {
  33: {
    name: 'Cardiovascular Stress / Tachycardia Indicator',
    description: 'Fires heavily on rapid heart rate (>100 bpm) and clinical signs of acute myocardial workload exertion.',
    category: 'Critical',
    priority: 'High',
  },
  105: {
    name: 'Hypoxia Risk / Respiratory Distress Pathway',
    description: 'Correlates with arterial oxygen saturation drop (<93%) and descriptive indicators of acute respiratory fatigue.',
    category: 'Critical',
    priority: 'High',
  },
  412: {
    name: 'Neurological Dysfunction / Altered Consciousness',
    description: 'Detects acute neurologic symptoms, low verbal responsiveness, or unconscious states on the AVPU scale.',
    category: 'Critical',
    priority: 'High',
  },
  1042: {
    name: 'Acute Nociceptive Pain Pathway',
    description: 'Activates on elevated pain scores (8/10 to 10/10) and patient descriptions of high-intensity painful stimulus.',
    category: 'Critical',
    priority: 'High',
  },
  2201: {
    name: 'Vascular Shock / Acute Hypotension Detector',
    description: 'Correlates with critical blood pressure drops (systolic <90 mmHg) representing high risk of circulatory collapse.',
    category: 'Critical',
    priority: 'High',
  },
  3504: {
    name: 'Geriatric Vulnerability / Age Risk Factor',
    description: 'Fires for patients over 65 presenting with emergent symptoms requiring rapid geriatric observation.',
    category: 'Clinical',
    priority: 'Medium',
  },
  4801: {
    name: 'Pediatric Vulnerability / Infant Critical Factor',
    description: 'Activates for neonates and infants under 5 years requiring immediate priority clinical observation.',
    category: 'Clinical',
    priority: 'Medium',
  },
  6012: {
    name: 'Systemic Hyperthermia / Infection Vector',
    description: 'Fires on highly elevated body temperature (>38.5°C) indicating active systemic inflammatory response.',
    category: 'Clinical',
    priority: 'Medium',
  },
  7823: {
    name: 'Hypertensive Crisis Pathway',
    description: 'Correlates with extremely high blood pressure (>180/120 mmHg) indicating elevated threat of end-organ injury.',
    category: 'Clinical',
    priority: 'Medium',
  },
  9215: {
    name: 'Hypoglycemic Metabolic Strain Indicator',
    description: 'Detects critical blood glucose depletion (<4.0 mmol/L) presenting high risk of hypoglycemic shock.',
    category: 'Clinical',
    priority: 'Medium',
  },
  11400: {
    name: 'Acute Coronary Syndrome (ACS) Chest Pain Vector',
    description: 'Fires on classic descriptors of radiating substernal chest pressure, arm/jaw numbness, or angina.',
    category: 'Critical',
    priority: 'High',
  },
  13204: {
    name: 'Dyspnea / Accessory Muscle Use Indicator',
    description: 'Correlates with acute shortness of breath, hyperventilation, or respiratory muscle fatigue.',
    category: 'Critical',
    priority: 'High',
  },
  14902: {
    name: 'Visceral Nociception / Abdominal Pain Distress',
    description: 'Activates on localized or sharp visceral abdominal pain and related gastrointestinal distress complaints.',
    category: 'Clinical',
    priority: 'Medium',
  },
};

export function getFeatureMetadata(index: number): FeatureMetadata {
  // Check curated database first
  if (curatedFeatures[index]) {
    return curatedFeatures[index];
  }

  // Fallback for unmapped arbitrary latent features
  return {
    name: `Unmapped Latent Feature (F#${index})`,
    description: `Latent SAE dictionary feature dimension #${index}. No specific clinical concept is currently mapped to this feature index.`,
    category: 'Structural',
    priority: 'Low',
  };
}
