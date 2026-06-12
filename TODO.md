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
8. **Baseline Recalibration Detection** *(added 2026-06-12)*
   - Detect when semantic embedding scores need recalibration — ideally triggered automatically during model add/swap in Agent Governance. When a new model is set as active, prompt the clinician to re-run the prompt suite and commit a fresh baseline before the first audit. Prevents spurious `61% < 65% floor` warnings caused by cross-model baseline mismatch.
9. **Agent Governance UX Improvements** *(added 2026-06-12)*
   - Improve configure/add/change/list agent workflows in the governance panel. Key additions:
     - **Recalibrate** action per agent: one-click re-run of prompt suite + commit new baseline to ledger.
     - **Active model indicator**: show which `TRIAGE_AGENT_SLUG` is currently wired to the API.
     - **Model health check**: surface Ollama connectivity and model availability status inline in governance.
10. **Commit & Merge Branch** *(added 2026-06-12)*
    - Commit all outstanding changes on `feature/docker-deployment` and merge to `main`. Includes: Dockerfile.nginx env-var fixes, BehaviorAuditView auto-registration guard, docker-compose Sepolia build args, and webpack config corrections.
11. **Prune PROJECT_MEMORY.md** *(added 2026-06-12)*
    - Remove stale entries and update `current state`, `active branch`, and `in progress` sections to reflect the current MVP deployment state.

## Medium Priority: Scale & Compliance

12. **Semantic Drift Monitoring (v2, Embeddings)**
    - Introduce embedding-based similarity (Cosine distance) for the same probe suite to improve resilience against paraphrases and style shifts.
    - Combine lexical and semantic drift into a unified behavioral drift score for advanced enforcement decisions.
13. **Regulatory Export Service (C2PA-signed PDF Logs)**
    - Create a service to generate non-binding PDF audit certificates proving system integrity for internal or experimental compliance review.
14. **Integrity Observability (Prometheus/Grafana)**
    - Establish monitoring for ledger health, automated integrity fault detection, and cross-agent behavioral drift metrics at scale.
15. **Multi-Agent Comparative Triage (V2)**
    - Enable side-by-side auditing of different AI models or versions against the same clinical case to streamline model-switchover risk assessments.
16. **Fix PhiGuard BERT-NER Pipeline** *(added 2026-06-12)*
    - The `onnxruntime-node` ARM64 native binding fails to load inside the Docker container on Apple Silicon (`ld-linux-aarch64.so.1` not found). NER tier is disabled; regex + keyword tiers remain active as fallback. Fix options: (a) build a multi-platform image with the correct `onnxruntime` Linux ARM64 binary, or (b) replace with a pure-JS NER alternative. **Non-blocking for MVP** — regex/keyword PHI masking is active.
17. **Verify Remote Server Docker Pull & Update Pipeline** *(added 2026-06-12)*
    - Test and verify the full image promotion pipeline to `clinicianledger.ca`: SSH pipe (`docker save | gzip | ssh ... docker load`) or registry-based pull. Confirm containers restart cleanly and DB migrations run without data loss on the live demo server.

## Lower Priority / Deferred

   - **Automatic Lexical Drift Monitoring (v1) & Drift Charts**
     - *Deferred*: The current 5 working stages are sufficient for the core workflow validation. Periodic/automatic drift charts are important polish but are deferred to prioritize getting user validation on the core workflow.
   - **UI Version Tag Management**
     - *Deferred*: Dynamically managing the version tag is a low-impact polish task and is deferred in favor of hosting the MVP.
   - Defer environmental carbon-footprint mapping for blockchain operations until the core clinical integrity MVP is finalized.
   - Defer full EIP-712 signature storage (e.g., LocalStorage / database sidecar) and in-memory Sandbox signing to make the signature verification flow functional on lookup.
   - **Post-MVP: Direct Verification of Divergence Signal on Production**
     - *Deferred*: Postponed production verification of the real-time divergence signal to post-MVP. Follow the platform policy requiring verification locally on `dev` before server deployment (`prod`).

## Next Immediate Actions

1. **Commit & Merge**: Commit all outstanding local changes and merge `feature/docker-deployment` → `main`.
2. **Verify Remote Deploy Pipeline**: Test the Docker image promotion to `clinicianledger.ca` and confirm the live demo is healthy.
3. **Prune PROJECT_MEMORY.md**: Update current state, branch, and in-progress sections to reflect MVP deployment.
4. **Baseline Recalibration**: Re-run the 5-prompt suite with `llama3:8b` as the active model and commit a fresh on-chain baseline to eliminate the cross-model semantic mismatch warning.
5. **Clinician Decision Ledger**: Connect database override actions to update the ledger with parent-child cryptographic amendments.

## Design Considerations
- **Regulatory Frameworks**: While not yet promising formal compliance, designs should consider **HIPAA** logging expectations and **EU AI Act** transparency obligations regarding auditability.
