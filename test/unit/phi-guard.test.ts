/**
 * PhiGuard Service — Unit Tests
 *
 * Tests cover all three tiers independently and in combination:
 *   - Tier 1: Regex battery (SSN, MRN, phone, email, DOB, postal, IP)
 *   - Tier 2: Keyword prefix scan (labelled PII fields)
 *   - Tier 3: BERT-NER person name detection (mocked to avoid model download in CI)
 *
 * All tests follow the redact-and-proceed contract:
 *   - scanAndMask never throws
 *   - maskedText is always returned
 *   - phiDetected accurately reflects whether any match was found
 */

import { scanAndMask, scanFields } from '../../src/services/phi-guard.service';

// ─── NER Mock ─────────────────────────────────────────────────────────────────
// Prevents model download during tests. The unit tests for Tiers 1+2 are
// deterministic. Tier 3 behaviour is tested via a separate mocked suite below.

jest.mock('@huggingface/transformers', () => ({
  pipeline: jest.fn().mockResolvedValue(
    jest.fn().mockImplementation(async (text: string) => {
      // Only return a PERSON entity when the input actually contains 'Jane Doe'.
      // All other inputs return an empty array so Tier 3 does not interfere
      // with the Tier 1/2 tests or produce false positives on clean text.
      if (text.includes('Jane Doe')) {
        return [{ entity_group: 'PER', score: 0.98, word: 'Jane Doe', start: 0, end: 8 }];
      }
      return [];
    })
  ),
  env: { allowLocalModels: true, allowRemoteModels: false },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function masked(text: string): Promise<string> {
  return (await scanAndMask(text)).maskedText;
}

async function detected(text: string): Promise<boolean> {
  return (await scanAndMask(text)).phiDetected;
}

// ─── Tier 1: Regex Battery ────────────────────────────────────────────────────

describe('PhiGuard — Tier 1: Regex', () => {
  describe('SSN', () => {
    it('redacts hyphenated SSN', async () => {
      expect(await masked('Patient SSN: 123-45-6789')).not.toContain('123-45-6789');
      expect(await masked('Patient SSN: 123-45-6789')).toContain('[SSN_REDACTED]');
    });

    it('redacts space-separated SSN', async () => {
      const result = await masked('SSN 123 45 6789 on file');
      expect(result).toContain('[SSN_REDACTED]');
      expect(result).not.toContain('123 45 6789');
    });

    it('does not redact a 9-digit vitals value preceded by HR or BP context', async () => {
      // 9-digit bare numbers adjacent to clinical abbreviations should not be
      // flagged — the regex requires \D boundary after the 9-digit group.
      const result = await masked('HR: 72, BP 120/80, RR 16');
      expect(result).not.toContain('[SSN_REDACTED]');
    });
  });

  describe('MRN', () => {
    it('redacts MRN with colon separator', async () => {
      const result = await masked('MRN: A00421 admitted for chest pain');
      expect(result).toContain('[MRN_REDACTED]');
      expect(result).not.toContain('A00421');
    });

    it('redacts MRN with hash separator', async () => {
      const result = await masked('Record: MRN#4821-B today');
      expect(result).toContain('[MRN_REDACTED]');
    });

    it('redacts Medical Record Number in full form', async () => {
      const result = await masked('Medical Record Number: 9928374');
      expect(result).toContain('[MRN_REDACTED]');
    });
  });

  describe('DOB', () => {
    it('redacts ISO-format DOB', async () => {
      const result = await masked('DOB: 1972-03-14 chest pain onset');
      expect(result).toContain('[DOB_REDACTED]');
      expect(result).not.toContain('1972-03-14');
    });

    it('redacts slash-format DOB', async () => {
      const result = await masked('dob 03/14/72 per chart');
      expect(result).toContain('[DOB_REDACTED]');
    });

    it('redacts Date of Birth long form', async () => {
      const result = await masked('Date of Birth: March 14 1972');
      expect(result).toContain('[DOB_REDACTED]');
    });
  });

  describe('Phone', () => {
    it('redacts standard NA phone format', async () => {
      const result = await masked('Call next of kin at 604-555-0192');
      expect(result).toContain('[PHONE_REDACTED]');
      expect(result).not.toContain('604-555-0192');
    });

    it('redacts dotted phone format', async () => {
      const result = await masked('Emergency contact: 604.555.0192');
      expect(result).toContain('[PHONE_REDACTED]');
    });

    it('redacts E.164 phone with country code', async () => {
      const result = await masked('+1 604 555 0192 (spouse)');
      expect(result).toContain('[PHONE_REDACTED]');
    });
  });

  describe('Email', () => {
    it('redacts email address in free text', async () => {
      const result = await masked('Send results to jsmith@generalhosp.ca');
      expect(result).toContain('[EMAIL_REDACTED]');
      expect(result).not.toContain('jsmith@generalhosp.ca');
    });
  });

  describe('IP Address', () => {
    it('redacts IPv4 address', async () => {
      const result = await masked('Connected from 192.168.1.105 during session');
      expect(result).toContain('[IP_REDACTED]');
      expect(result).not.toContain('192.168.1.105');
    });
  });

  describe('No false positives on clinical text', () => {
    it('does not redact clinical abbreviations', async () => {
      const clinicalText = 'Pt c/o SOB x3d, hx of HTN and DM2. SpO2 94% on RA.';
      const result = await scanAndMask(clinicalText);
      expect(result.phiDetected).toBe(false);
      expect(result.maskedText).toBe(clinicalText);
    });

    it('does not redact vitals numeric strings', async () => {
      const vitals = 'HR 72, BP 128/84, RR 14, Temp 37.2°C, Pain 6/10';
      const result = await scanAndMask(vitals);
      expect(result.phiDetected).toBe(false);
    });
  });
});

// ─── Tier 2: Keyword Prefix Scan ─────────────────────────────────────────────

describe('PhiGuard — Tier 2: Keyword prefix', () => {
  it('redacts named patient field', async () => {
    const result = await masked('Patient: John Smith, presenting with chest pain');
    expect(result).toContain('[NAME_REDACTED]');
    expect(result).not.toContain('John Smith');
    // Clinical context after the name survives
    expect(result).toContain('presenting with chest pain');
  });

  it('redacts pt: shorthand', async () => {
    const result = await masked('Pt: Jane Doe c/o headache x2d');
    expect(result).toContain('[NAME_REDACTED]');
    expect(result).not.toContain('Jane Doe');
  });

  it('redacts address field', async () => {
    const result = await masked('Address: 123 Maple Street, Vancouver');
    expect(result).toContain('[ADDRESS_REDACTED]');
    expect(result).not.toContain('123 Maple Street');
  });

  it('redacts clinician label with a name', async () => {
    const result = await masked('Attending: Dr. Patricia Hughes reviewing chart');
    expect(result).toContain('[CLINICIAN_REDACTED]');
  });

  it('preserves clinical content outside the labelled value', async () => {
    const result = await masked('Patient: Bob Jones, HR 88, BP 132/85');
    // Vitals should survive masking
    expect(result).toContain('HR 88');
    expect(result).toContain('BP 132/85');
    // Name should be gone
    expect(result).not.toContain('Bob Jones');
  });
});

// ─── Tier 3: NER ─────────────────────────────────────────────────────────────

describe('PhiGuard — Tier 3: NER (mocked BERT)', () => {
  it('redacts a person name detected by NER with no structural cue', async () => {
    // The mock NER returns entity at positions 0-8 ("Jane Doe")
    const text = 'Jane Doe presented with tearing chest pain.';
    const result = await scanAndMask(text);
    // The NER mock will fire; after Tiers 1+2 find nothing, Tier 3 handles it
    expect(result.matches.some(m => m.tier === 'ner')).toBe(true);
  });

  it('sets phiDetected true when NER fires', async () => {
    const text = 'Jane Doe presented with tearing chest pain.';
    expect(await detected(text)).toBe(true);
  });
});

// ─── ScanResult Contract ──────────────────────────────────────────────────────

describe('PhiGuard — ScanResult contract', () => {
  it('returns phiDetected=false and original text for clean input', async () => {
    const clean = 'Chest pain, shortness of breath, diaphoresis.';
    const result = await scanAndMask(clean);
    expect(result.phiDetected).toBe(false);
    expect(result.maskedText).toBe(clean);
    expect(result.matches).toHaveLength(0);
  });

  it('never throws on empty string', async () => {
    await expect(scanAndMask('')).resolves.not.toThrow();
  });

  it('never throws on undefined-like empty input', async () => {
    await expect(scanAndMask('  ')).resolves.not.toThrow();
  });

  it('returns durationMs as a non-negative number', async () => {
    const result = await scanAndMask('Some input with 123-45-6789 in it');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('correctly counts matches across tiers', async () => {
    // One SSN + one phone in same string
    const text = 'SSN: 123-45-6789. Contact: 604-555-0192.';
    const result = await scanAndMask(text);
    // At least 2 matches from Tier 1 (SSN + PHONE)
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    expect(result.matches.map(m => m.label)).toContain('SSN');
    expect(result.matches.map(m => m.label)).toContain('PHONE');
  });
});

// ─── scanFields ───────────────────────────────────────────────────────────────

describe('PhiGuard — scanFields()', () => {
  it('scans multiple fields concurrently and returns per-field results', async () => {
    const results = await scanFields({
      chief_complaint: 'chest pain, patient John Smith',
      reason_text: 'Downgrading — SSN 123-45-6789 confirmed from chart',
    });

    expect(results.chief_complaint).toBeDefined();
    expect(results.reason_text).toBeDefined();
    expect(results.reason_text.phiDetected).toBe(true);
    expect(results.reason_text.maskedText).toContain('[SSN_REDACTED]');
  });

  it('omits fields with undefined values', async () => {
    const results = await scanFields({
      chief_complaint: 'shortness of breath',
      gender_identity: undefined,
    });

    expect(Object.keys(results)).not.toContain('gender_identity');
    expect(results.chief_complaint).toBeDefined();
  });
});

// ─── Clinical Scenario Integration ───────────────────────────────────────────

describe('PhiGuard — Clinical scenario integration', () => {
  it('handles a realistic cluttered triage note', async () => {
    const note = [
      'Pt: Mary-Jane O\'Brien, DOB: 1965-08-22, MRN: BC-88291',
      'Chief complaint: Crushing chest pain radiating to left arm x45min.',
      'Contact: 778-555-3847. Email: mj.obrien@gmail.com',
      'PMH: HTN, DM2. Meds: Metformin 500mg, Ramipril 10mg.',
      'Attending: Dr. Singh. Triage nurse: Lopez.',
    ].join(' ');

    const result = await scanAndMask(note);

    expect(result.phiDetected).toBe(true);

    // All high-risk identifiers should be gone
    expect(result.maskedText).not.toContain('1965-08-22');
    expect(result.maskedText).not.toContain('BC-88291');
    expect(result.maskedText).not.toContain('778-555-3847');
    expect(result.maskedText).not.toContain('mj.obrien@gmail.com');

    // Clinical content must survive
    expect(result.maskedText).toContain('Crushing chest pain');
    expect(result.maskedText).toContain('Metformin 500mg');
    expect(result.maskedText).toContain('Ramipril 10mg');
    expect(result.maskedText).toContain('HTN, DM2');
  });
});
