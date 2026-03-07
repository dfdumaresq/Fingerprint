# AI Agent Fingerprinting and Verification System
## Threat Model & Robustness Specification

**Version:** 1.0  
**Date:** December 2025  
**Classification:** Customer-Facing

---

## Executive Summary

This document defines the adversarial threat model for the AI Agent Fingerprinting System—a verification system that proves which AI agent generated an action and whether that agent has been tampered with. It specifies the attacks we defend against, our robustness targets under adversarial conditions, and the operational guarantees we offer to platform customers under real-world evasion attempts.

**Core Value Proposition:** We do more than label content as "AI-generated." We verify *which AI agent* produced it and detect when an agent has been swapped, secretly fine-tuned, or impersonated—even when attackers actively try to evade detection—so platforms can trust which agent is acting on their behalf.

**Key Threats Addressed:**
- **Model Substitution** — Swapping a registered agent for a cheaper or less capable model
- **Shadow Fine-Tuning** — Secretly modifying model weights to circumvent policies
- **Agent Impersonation** — Routing requests through unregistered or unauthorized agents
- **Prompt-Level Evasion** — Crafting inputs designed to defeat verification

---

## 1. Scope & Assumptions

### 1.1 Protected Assets
| Asset | Description |
|-------|-------------|
| **Behavioral Signature** | Hashed response patterns from standardized diagnostic prompts (core detection) |
| **Cryptographic Identity** | Fingerprint hash linking agent metadata to registrant (database or optional blockchain) |
| **Provenance Manifest** | C2PA-compatible signed assertions for ecosystem interoperability |
| **Audit Trail** | Optional tamper-evident timestamping via blockchain or trusted timestamping service |

### 1.2 Threat Actors

| Actor | Capability | Motivation |
|-------|------------|------------|
| **Model Substitutor** | Black-box API access; can swap backend model | Cost reduction, capability fraud |
| **Fine-Tune Drifter** | Model owner; can modify weights | Policy circumvention, capability shift |
| **Impersonator** | Black-box; attempts to mimic registered model | Reputation hijacking, trust exploitation |
| **Evasion Attacker** | Query access to verification API | Bypass detection for malicious content |

### 1.3 Assumptions
- Attacker has **black-box access** to verification API (can submit inputs, observe pass/fail)
- Attacker does **not** have access to behavioral test prompts in advance
- If blockchain audit layer is enabled, records are tamper-evident under the security properties of the chosen network
- Cryptographic signing keys are **not compromised**

---

## 2. Attack Taxonomy

### 2.1 Attacks We Defend Against ✅

| Attack Family | Description | Defense Mechanism |
|---------------|-------------|-------------------|
| **Model Substitution** | Replacing registered model with cheaper/different model | Behavioral trait verification detects response divergence |
| **Paraphrase Evasion** | Rewording responses to defeat hash matching | Semantic canonicalization before hashing |
| **Synonym Substitution** | Replacing key terms with synonyms | Semantic normalization layer |
| **Formatting Variation** | Whitespace, punctuation, casing changes | Input canonicalization |
| **Light Compression** | Minor text compression/encoding | Perturbation detection flags artifacts |
| **Response Truncation** | Partial response to evade full matching | Similarity thresholds vs. binary match |

### 2.2 Robustness Targets

| Attack Type | Perturbation Budget | Target TPR @ 1% FPR |
|-------------|---------------------|---------------------|
| Paraphrase (≤20% token change) | 20% tokens modified | ≥ 85% |
| Synonym swap (≤10 substitutions) | 10 word replacements | ≥ 90% |
| Formatting variation | Whitespace/punctuation only | ≥ 99% |
| Model substitution (different family) | Complete model swap | ≥ 95% |
| Fine-tune drift (>5% weight change) | Measurable capability shift | ≥ 80% |

### 2.3 Attacks Out of Scope ❌

| Attack | Reason for Exclusion |
|--------|----------------------|
| **Heavy paraphrase (>50% rewrite)** | Semantic meaning fundamentally altered; legitimate use case ambiguity |
| **Adversarial prompt injection** | Separate threat class; recommend layered defense |
| **Cryptographic attacks on Ethereum** | Outside our security boundary |
| **Compromised registration wallet** | Key management is customer responsibility |
| **White-box attacks (gradient access)** | Requires model internals; assumed black-box only |

---

## 3. Detection Modes

We provide two operational modes optimized for different use cases:

### 3.1 Enforcement Mode (High Precision)
- **Use Case:** Automated blocking, policy enforcement
- **Target:** FPR ≤ 1%, accept lower TPR
- **Threshold:** Conservative match requirements
- **Output:** Binary PASS/FAIL

### 3.2 Triage Mode (High Recall)  
- **Use Case:** Human review queues, audit workflows
- **Target:** TPR ≥ 95%, accept higher FPR (~5%)
- **Threshold:** Sensitive to potential violations
- **Output:** Risk score (0-100) + confidence interval

---

## 4. Operational Guarantees

### 4.1 Availability
| Metric | Target |
|--------|--------|
| API Uptime | 99.9% (8.7 hrs downtime/year) |
| Verification Latency (p95) | < 500ms |
| Audit Layer Sync (if enabled) | < 2 blocks / < 60s for TSA |

### 4.2 Monitoring & Alerting
- Real-time anomaly detection on verification failure rates
- Automated alerts when drift exceeds thresholds
- Daily robustness metrics dashboard

### 4.3 Incident Response
| Severity | Response Time | Resolution Target |
|----------|---------------|-------------------|
| Critical (bypass detected) | < 1 hour | < 4 hours |
| High (elevated evasion rate) | < 4 hours | < 24 hours |
| Medium (performance degradation) | < 24 hours | < 72 hours |

---

## 5. Verification Evidence

Each verification returns forensic evidence for audit purposes:

```json
{
  "verdict": "PASS | FAIL | REVIEW",
  "confidence": 0.87,
  "similarityScore": 0.92,
  "perturbationFlags": {
    "formatNormalized": true,
    "semanticDrift": 0.08,
    "compressionArtifacts": false
  },
  "registrationData": {
    "agentId": "...",
    "registeredAt": "2025-01-15T...",
    "registrant": "org_id or 0x..."
  },
  "provenance": {
    "c2paManifest": "optional_uri",
    "blockchainTx": "optional_0x..."
  },
  "auditTrail": {
    "verificationId": "uuid",
    "timestamp": "...",
    "inputHash": "0x..."
  }
}
```

---

## 6. Continuous Improvement

### 6.1 Red Team Schedule
- **Monthly:** Internal adversarial testing against new attack variants
- **Quarterly:** External red team engagement
- **Continuous:** Automated attack simulation in CI/CD pipeline

### 6.2 Robustness Reporting
- Public robustness scorecard updated quarterly
- Attack variant coverage matrix
- False positive/negative trend analysis

---

## 7. Standards Alignment

### 7.1 C2PA / Content Authenticity Initiative

Our system is designed for interoperability with the [C2PA specification](https://c2pa.org/):

| C2PA Concept | Our Implementation |
|--------------|--------------------|
| **Claim** | Behavioral fingerprint + identity assertion |
| **Assertion** | Model substitution / drift detection results |
| **Manifest** | Signed provenance record (exportable) |
| **Hard Binding** | Optional blockchain anchor |

**Integration Path:** Verification results can be exported as C2PA-compatible assertions for embedding in content manifests, enabling ecosystem interoperability with Adobe CAI, Microsoft, and other C2PA members.

### 7.2 Audit Layer Options

| Layer | Use Case | Trade-offs |
|-------|----------|------------|
| **Database (default)** | Standard deployment | Fast, low cost, centralized trust |
| **RFC 3161 Timestamping** | Compliance-focused | Neutral third-party, no crypto overhead |
| **Blockchain (Ethereum/L2)** | Maximum transparency | Public verifiability, higher cost |

> **Recommendation:** Start with database + C2PA manifests. Add blockchain only for customers with explicit decentralization or regulatory requirements.

---

## Appendix: Comparison to Traditional AI Detectors

| Capability | Traditional Detectors | Our System |
|------------|----------------------|-------------|
| Detects AI-generated content | ✅ | ✅ |
| Verifies specific model identity | ❌ | ✅ |
| Detects model substitution | ❌ | ✅ |
| Adversarial robustness targets | Rarely published | ✅ Specified |
| C2PA/CAI compatible | Varies | ✅ |
| Tamper-evident audit trail | ❌ | ✅ (optional blockchain) |
| Revocation capability | ❌ | ✅ |

---

**Contact:** [Your contact info]  
**Documentation:** [Link to technical docs]
