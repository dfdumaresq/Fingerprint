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

1. **Clinician Decision Ledger (Immutable History)**
   - Implement "Clinician Decision" events to track how human reviewers accept, modify, or override AI recommendations. These must be logged as cryptographically anchored amendments to the original record.
2. **Interactive Audit Timeline (Evidence Chain Visualization)**
   - Develop a visual timeline for clinicians to trace the "Chain of Evidence." This surfaces underlying Merkle-chain connectivity as intuitive trust signals without requiring deep technical knowledge.
3. **PHI Masking & Guardrail Engine**
   - Implement automated detection and masking of Protected Health Information (PHI) to ensure that high-integrity audit logs focus on system behavior and decisions rather than patient-specific data.
4. **Unified "Baseline-then-Audit" Workflow**
   - Consolidate the Registration and Verification views into a single, cohesive audit flow. **Goal**: Avoid forcing clinicians to think in terms of "Blockchain Registration" vs. "Verification" steps.

## Medium Priority: Scale & Compliance

5. **Regulatory Export Service (C2PA-signed PDF Logs)**
   - Create a service to generate non-binding PDF audit certificates proving system integrity for internal or experimental compliance review.
6. **Integrity Observability (Prometheus/Grafana)**
   - Establish monitoring for ledger health, automated integrity fault detection, and cross-agent behavioral drift metrics at scale.
7. **Multi-Agent Comparative Triage (V2)**
   - Enable side-by-side auditing of different AI models or versions against the same clinical case to streamline model-switchover risk assessments.

## Lower Priority / Deferred

8. **Generic Blockchain UI Components**
   - Defer work on universal network selectors, wallet-specific UX, and L2 switchers unless a concrete anchoring scenario requires it.
9. **Environmental Impact Tracking**
   - Defer environmental carbon-footprint mapping for blockchain operations until the core clinical integrity MVP is finalized.

## Next Immediate Actions

1. **Unified Audit Workflow**: Merge `BehavioralRegistration` and `BehavioralVerification` components into a single "Establish Baseline & Audit" interface.
2. **PHI Masking Engine**: Audit the current event logging structure (`EventService`) to identify where masking guardrails are most critical.

## Design Considerations
- **Regulatory Frameworks**: While not yet promising formal compliance, designs should consider **HIPAA** logging expectations and **EU AI Act** transparency obligations regarding auditability.
