# Medical AI Audit Ledger & Integrity Platform Roadmap

This roadmap tracks the evolution of the Fingerprint project from a foundational trust layer into a specialized clinical audit and integrity product.

## Completed Items ✅

1. **OpenAPI 3.0.3 Specification**
   - ✅ Canonical API contract implemented in `src/api/openapi.yaml` and accessible via the `/api-docs` endpoint.
2. **Tamper Demonstration Suite**
   - ✅ Proof-of-integrity workflow implemented in `scripts/tamper-demo.ts` (`npm run demo:tamper`) to visualize detection paths.
3. **Behavioral Verification Engine**
   - ✅ Foundation for behavioral signatures and dual audit modes (Triage/Enforcement) implemented in `src/api/server.ts` and `src/components/BehavioralVerification.tsx`.
4. **Platform Documentation & Product Framing**
   - ✅ README overhaul establishing "Clinical UX Goals" and the pivot to a high-integrity medical audit narrative.
5. **Secure Key Management & Audit Logging**
   - ✅ Implemented OWASP-aligned key management and comprehensive security auditing for blockchain interactions.

## High Priority: Clinical Trust & Workflow

1. **Host MVP**
   - Deploy and host the current MVP to an accessible staging/production environment. The 5-stage behavioral drift audit workflow (Select Agent -> Baseline Status -> Prompt Suite -> Result) is fully operational and ready to demonstrate real value and gather early feedback from clinicians.
2. **Clinician Decision Ledger (Immutable History)**
   - Implement "Clinician Decision" events to track how human reviewers accept, modify, or override AI recommendations. These must be logged as cryptographically anchored amendments to the original record.
3. **Interactive Audit Timeline (Evidence Chain Visualization)**
   - Develop a visual timeline for clinicians to trace the "Chain of Evidence." This surfaces underlying Merkle-chain connectivity as intuitive trust signals without requiring deep technical knowledge.
4. **PHI Masking & Guardrail Engine**
   - Implement automated detection and masking of Protected Health Information (PHI) to ensure that high-integrity audit logs focus on system behavior and decisions rather than patient-specific data.
5. **Unified "Baseline-then-Audit" Workflow**
   - Consolidate the Registration and Verification views into a single, cohesive audit flow. **Goal**: Avoid forcing clinicians to think in terms of "Blockchain Registration" vs. "Verification" steps.
6. **Demographic & Identity Model Refresh**
   - 🏗️ Implement structured `PatientContext` to support non-binary identities and coarse-granularity regional attributes.
7. **Complete Canon Documentation Notes**
   - Flesh out the remaining empty wiki canon notes to ensure permanent systems documentation is fully complete:
     - [ ] `AI Fingerprinting - Master Note` (Core concept & portal overview)
     - [ ] `AI Fingerprinting - Current Phase` (Milestone progress logs)
     - [ ] `AI Fingerprinting - Crypto Design` (EIP-712 typing, keystores, and signing logic)
     - [ ] `AI Fingerprinting - Blockchain Anchoring` (Sepolia smart contracts and Merkle root batching)
     - [ ] `AI Fingerprinting - Threat Model` (Homographs, wrappers, and injection vector mitigations)
     - [ ] `AI Fingerprinting - Medical Audit Reuse` (Regulatory mapping and EMR integration scenarios)
     - [ ] `AI Fingerprinting - Decision Log` (Historical design choices and pivots)
     - [ ] `AI Fingerprinting - Latest Log` (Pointer to the active session log)

## Medium Priority: Scale & Compliance

8. **Semantic Drift Monitoring (v2, Embeddings)**
   - Introduce embedding-based similarity (Cosine distance) for the same probe suite to improve resilience against paraphrases and style shifts.
   - Combine lexical and semantic drift into a unified behavioral drift score for advanced enforcement decisions.
9. **Regulatory Export Service (C2PA-signed PDF Logs)**
   - Create a service to generate non-binding PDF audit certificates proving system integrity for internal or experimental compliance review.
10. **Integrity Observability (Prometheus/Grafana)**
    - Establish monitoring for ledger health, automated integrity fault detection, and cross-agent behavioral drift metrics at scale.
11. **Multi-Agent Comparative Triage (V2)**
    - Enable side-by-side auditing of different AI models or versions against the same clinical case to streamline model-switchover risk assessments.

## Lower Priority / Deferred

   - **Automatic Lexical Drift Monitoring (v1) & Drift Charts**
     - *Deferred*: The current 5 working stages are sufficient for the core workflow validation. Periodic/automatic drift charts are important polish but are deferred to prioritize getting user validation on the core workflow.
   - **UI Version Tag Management**
     - *Deferred*: Dynamically managing the version tag is a low-impact polish task and is deferred in favor of hosting the MVP.
   - Defer environmental carbon-footprint mapping for blockchain operations until the core clinical integrity MVP is finalized.
   - Defer full EIP-712 signature storage (e.g., LocalStorage / database sidecar) and in-memory Sandbox signing to make the signature verification flow functional on lookup.

## Next Immediate Actions

1. **Host MVP**: Set up hosting infrastructure and deploy the application to allow clinicians to interact with the core 5-stage drift audit workflow.
2. **Clinician Decision Ledger**: Connect database override actions to update the ledger with parent-child cryptographic amendments.

## Design Considerations
- **Regulatory Frameworks**: While not yet promising formal compliance, designs should consider **HIPAA** logging expectations and **EU AI Act** transparency obligations regarding auditability.
