---
project: AI Fingerprinting / Verification System
short_name: fingerprint-ai
status: active
owner: Dave Dumaresq
last_updated: 2026-05-23
primary_repo: /Users/dfdumaresq/Projects/Fingerprint
primary_vault_note: [[AI Fingerprinting - Master Note]]
phase: Medical MVP & Inclusive Demographics (v1.1.0) / Phase 2 SAE Groundwork
trust_level: experimental (Phase 1 Completed, Phase 2 in progress)
---

# PROJECT_MEMORY

## 1. Mission
Design and implement a system that can generate, preserve, and verify trustworthy provenance signals for AI-produced outputs, with an emphasis on auditability, reproducibility, and clear verification boundaries.

## 2. Product thesis
Core thesis:
- AI systems need verifiable provenance, not just claims of provenance.
- Verification should survive handoffs across tools, services, and organizations.
- The system must separate evidence, claims, and trust interpretation.

Why this matters:
- Enterprises need audit trails for high-stakes use.
- Medical or regulated settings need stronger traceability than consumer AI workflows.
- Trust must come from inspectable records, signatures, and policy checks rather than UI assertions.

## 3. Current phase
Phase:
- Medical MVP & Inclusive Demographics (v1.1.0) / Phase 2 SAE Groundwork

Phase objective:
- Harden behavioral verification, complete the clinician-facing triage queue (with structured PatientContext and decision logging), and lay the groundwork for Phase 2 Sparse Autoencoder (SAE) neurological latent concept auditing.

Definition of done:
- [x] Robust demographic models including Sex At Birth (with unknown/intersex fallbacks) and Gender Identity in `PatientContext`.
- [x] SAE Layer 9 visual audit panel categorizing active latent concepts (Critical, Clinical, Cognitive, Structural) by activation strength.
- [x] Clinician decision overrides and amendments logged as cryptographically anchored ledger entries.
- [ ] Unified "Baseline-then-Audit" UI workflow merging registration and verification into a single clinician screen.
- [ ] Comprehensive automated PHI masking guardrails in `EventService`.

Out of scope for this phase:
- Production deployment on mainnet networks (restricted to Sepolia and local simulation environments).
- Dynamic, automated context-drift tracking or real-time continuous learning adjustments (deferred to Phase 3).

## 4. Current state
Active Git Branch:
- `feat/parallel-semantic-audit` (Completed: Real-time Parallel Semantic Embedding Alignment Audit and Pre-Submission Clinical Contradiction Guardrail)

Confirmed:
- **Safety-Grade Behavioral Verification**: Fully operational off-chain verification using token-based Jaccard similarity (Bag-of-Words) and canonicalization layers to defeat formatting and whitespace attacks.
- **Unicode Perturbation Detector**: Active screening for encoding anomalies and Cyrillic homograph attacks, successfully triggering rejections (0% confidence) when spoofing is detected.
- **Structured PatientContext**: Fully typed, inclusive, and PHI-aware schema containing high-granularity regional, demographic, and clinical indicators without violating patient privacy rules.
- **Layer 9 SAE Latent Concept Panel**: UI dashboard organizes active SAE concepts (Critical, Clinical, Cognitive, Structural) and renders floating-point strengths alongside dynamic visual activation bars.
- **Parallel Semantic Embedding Alignment Audit**: Fully implemented real-time cosine similarity comparisons against ESI gold-standard sentinel prompts. Runs in parallel with the SAE audit via `Promise.all` in the drawer.
- **Pre-Submission Clinical Contradiction Guardrail**: Implemented asynchronous semantic validation to intercept and block chest symptom admissions with `0/10` pain score, featuring automatically expanded extended vitals, warning alerts, and safety bypass overrides.
- **Percentage-Mapped Attention Optimizations**: Implemented under-the-hood prompt formatting to map pain scores to percentages (`Pain 80%` and `Pain 0%`) to force value priority in the model's self-attention layers, resolving the high-frequency numeric token centering bias.
- **Stable Multi-Worker Test Suite**: Verified full API and frontend compliance; all 26 test suites (208 test cases) pass successfully.

In progress:
- **Unified Baseline & Drift Audit View**: Merging `BehavioralRegistration` and `BehavioralVerification` components to simplify clinician interaction under `behavior-audit`.
- **PHI Masking Engine**: Designing standard regex/dictionary guardrails for the append-only `EventService` ledger ingestion flow.

Blocked:
- None. Core hardhat contracts, postgres backend, and Express API layers are stable and operational.

## 5. System model
System pipeline:
1. **Clinical Encounter Intake**: Clinician inputs patient complaints, vitals, and structured, PHI-free `PatientContext`.
2. **Model / Agent Inference**: The active AI agent processes input and generates clinical acuity recommendations. *(Note: Dual-mode architecture supports lightweight deterministic rule fallbacks for offline testing, and live local/cloud LLMs—via Ollama or API adapters—to audit non-deterministic outputs and latent neural features).*
3. **Event Ingestion & Ledger Logging**: `EventService` captures inputs, outputs, and parameters, generating Keccak256 event-chains referencing the previous event.
4. **On-chain Anchoring**: Periodic batching generates Merkle roots of event blocks and commits them to the smart contract registry (Sepolia).
5. **Drift Auditing**: The system periodically compares live prompt responses against the registered on-chain baseline using safety-grade Jaccard metrics. *(Do we need to implement a manual audit workflow as well? Do we need to setup an automated schedule?)*
6. **Provenance Manifest Export**: Verification outcomes are signed and exported as standard, tamper-evident C2PA manifests.
7. **Human Clinician Review**: Human-in-the-loop actions (accepting, modifying, or overriding acuity) are recorded and chained as parent-child amendments.

Primary entities:
- Model output (Acuity recommendation)
- Prompt / instruction set (REASONING_TEST_SUITE_V1)
- Generation event (Ingested clinical encounter)
- Fingerprint artifact (Keccak256 identity baseline hash)
- Signed attestation (EIP-712 Typed Signature)
- Verification record (Jaccard similarity + perturbation analysis)
- Audit event (Chained ledger logs in postgres)
- Human reviewer action (Clinician accept / override)

Authoritative record of truth:
- **Authoritative**: Blockchain smart contract registries (agent keys, baseline hashes) and the append-only ledger of hash-chained events.
- **Derived**: Verification similarity metrics, drift percentages, and generated C2PA manifests.
- **Advisory**: Live triage UI alerts and loose Triage Mode warnings.

## 6. Provenance boundary
This section must stay precise.

What the system can currently prove:
- An AI agent's semantic output matches its registered baseline signature within a specific threshold (defeating wrapper-swaps).
- An audit event has not been tampered with or retroactively altered since ingestion (via sequential Keccak256 hash-chain checks).
- Human reviews and amendments are legitimately signed by authorized provider keys (via EIP-712 signatures).
- Formatting assaults, spacing injections, and character homograph spoofing have been intercepted and neutralized.

What the system cannot currently prove:
- The absolute medical correctness or safety of a recommendation (proves behavioral consistency, not absolute truth).
- Whether the model input was intercepted or manipulated before reaching the API gateway (Phase 2 SAE aims to resolve this).
- Cryptographic identity of external actors not possessing registered EVM keys.

Unsafe claims to avoid:
- “Guaranteed authentic medical diagnoses”
- “Tamper-proof end-to-end model sandboxing” (cannot prevent localized infrastructure compromise)
- “FDA-certified compliance” (system is currently a technical audit tool, not a certified clinical device)

## 7. Fingerprint design
Fingerprint purpose:
- Represents a unique, cryptographically anchored cognitive signature of an AI agent, derived from its performance across standardized clinical diagnostics.

Fingerprint inputs:
- Normalized and concatenated response strings responding to the 5 distinct reasoning prompts of the `REASONING_TEST_SUITE_V1`.

Normalization rules:
- NFC Unicode normalization.
- Force lowercasing.
- Collapse multiple sequential spaces and newlines into single spaces.
- Strip all non-semantic formatting, trailing whitespaces, and punctuation marks.

Hashing / digest approach:
- Keccak256 hash of the pipe-delimited (`|`) canonicalized response string, matching EVM gas-optimized patterns.

Important invariants:
- Identical canonical inputs will always produce the identical behavioral fingerprint hash.
- Any unauthorized model swap (e.g. replacing a complex model with a cheaper alternative) will break similarity thresholds and be flagged.
- Text containing visual-only homograph unicode characters (imposter scripts) will trigger elevated perturbation scores and drop verification confidence to 0%.

## 8. Cryptographic proof layer
Current proof mechanisms:
- Sequential Keccak256 event chaining (append-only ledger).
- EIP-712 Typed Data Signatures for clinician/agent authorization.
- Merkle root hashing for batch event validation on the Sepolia smart contract.
- Compliant C2PA provenance manifests with signed assertions (`com.fingerprint.identity.v1`).

Signing model:
- Agents sign their generated outputs with their private keys.
- Human clinicians sign their overrides/amendments using provider credentials.
- Keys are managed off-chain via `LocalStorageKeyStore` using browser WebCrypto APIs (ECDSA over P-256) and saved in `localStorage` as serialized JSON Web Key (JWK) structures (planned production upgrade: encryption at rest via user passphrase).

Verification model:
- The verifier compares the live agent output against the baseline using Token-based Jaccard similarity.
- Multi-mode support:
  * **Strict Enforcement**: Requires $\ge 95\%$ semantic match and $\le 20\%$ perturbation.
  * **Triage Advisory**: Requires $\ge 40\%$ semantic match and $\le 50\%$ perturbation.

Open proof questions:
- How to support secure key rotation for agents without invalidating legacy event chains?
- How to handle dynamic context accumulation without constantly triggering false-positive drift rejections?

Security assumptions:
- Key custody remains unbroken (compromised provider keys compromise logged overrides).
- The postgres event ledger's hashing sequences are validated prior to clinical reviews.

## 9. Blockchain / anchoring layer
Anchoring purpose:
- Establishes a public, immutable, and trusted timestamp record proving that a specific agent identity or clinical event history existed in a given state at a precise point in time.

Anchor target:
- Ethereum Sepolia Testnet (using Hardhat deployment and local blockchain provider integrations).

What is anchored:
- Unique agent registration records (fingerprint hashes, status flags).
- Periodic Merkle roots aggregating blocks of clinical audit events.

What is not anchored:
- Protected Health Information (PHI) of patients.
- Raw text prompts, medical histories, or clinician explanations.
- Cryptographic private keys.

Economic constraints:
- On-chain gas fees require aggressive event batching; roots are anchored periodically rather than per-encounter.

Operational constraints:
- Integrations must tolerate RPC timeouts and occasional chain reorganizations; local postgres serves as the immediate cache, synced asynchronously.

Design principle:
- Anchor the minimum necessary evidence to support later verification.

## 10. Audit architecture
Audit goals:
- Reconstruct what happened.
- Distinguish machine action from human action.
- Preserve ordering, timestamps, and decision points.
- Make external review possible without exposing unnecessary data.

Audit events to capture:
- Prompt submission
- Model invocation (AI recommendation)
- Output creation
- Fingerprint creation (Baseline registration)
- Signature / attestation event
- Verification request
- Human override / approval / rejection (Clinician action)
- Policy failure / warning (Drift and perturbation alerts)

Required audit properties:
- Immutable or append-only event history where feasible
- Clear event IDs
- Traceable actor identity or role
- Reproducible verification path

## 11. Medical-audit reuse
Potential reuse scenario:
- Use the same provenance and verification architecture for medical AI outputs, triage suggestions, or clinical workflow artifacts.

Medical constraints to remember:
- Do not assume clinical safety from provenance alone.
- Provenance is not equivalent to correctness.
- Patient data handling may prohibit anchoring sensitive details.
- Auditability must coexist with privacy and access control.
- Human review and accountability remain mandatory.

Questions for medical adaptation:
- What evidence is sufficient for audit?
- What must stay off-chain?
- What must be role-restricted?
- What would a regulator, hospital, or QA lead need to inspect?

## 12. Threat model
Primary threats:
- **Model Substitution / Wrapper Swapping**: Silently routing requests to unauthorized models post-registration (mitigated by Jaccard similarity monitoring).
- **Trivial Layout Attacks**: Evading exact-string matches via casing, trailing spaces, or line-breaks (mitigated by NFC Canonicalization).
- **Homograph Characters / Perturbations**: Evading lexical matching using foreign unicode characters (mitigated by the Perturbation Detector).
- **Slow Poisoning**: Iteratively re-registering baseline changes over time to drift behavior without triggering immediate alarms (requires audit review paths).
- **Unstructured PHI Ingestion**: Clinicians or models feeding private patient data into audit text blocks (mitigated by future PHI masking filters).
- **Clinician Key Theft & Session Hijacking**: Stolen provider wallets or active session tokens used to sign falsified decisions, overrides, or clinician amendments (mitigated by multi-signature thresholds and short-lived session expirations).
- **Sybil Encounter / Gas Exhaustion**: Mass generation of mock encounters to pollute databases or trigger excessive Merkle anchoring costs (mitigated by rate-limiting and gas-optimized batch queues).
- **Replay / Out-of-Sequence Attacks**: Intercepting and re-transmitting old, signed encounters to overwrite current patient workflows (mitigated by unique session UUIDs, strict time-windows, and hash-chain sequencing).

Mitigations:
- Token-based Jaccard similarity calculations.
- Strict unicode normalization layers.
- Out-of-bounds unicode character analysis.
- Off-chain dual enforcement/triage policies.
- Encrypted JWT session boundaries and EVM multi-signature verification.

Unresolved threats:
- **High-level adversarial mimicry**: A structurally separate model specifically fine-tuned and prompted to perfectly replicate the baseline's cognitive and formatting habits to bypass similarity thresholds.
- **Continuous learning context drift**: Natural output style transformations over massive conversation histories that eventually trigger false-positive drift alarms.
- **Prompt Injection / Acuity Jailbreaking**: Sophisticated prompt injection attacks that bypass the AI's safety guardrails without triggering Jaccard anomalies, causing the model to recommend dangerous clinical actions while mimicking normal output formatting.
- **Local Storage Keystore Purges**: Accidental loss of cryptographic key pairs due to browser cache clearing, resulting in manual provider administrative re-registration cycles.

## 13. Non-negotiable constraints
- Never blur the line between evidence and interpretation.
- Never claim more verification than the system can actually support.
- Prefer inspectable protocols over opaque magic.
- Keep sensitive content out of public anchors unless explicitly justified.
- Separate raw artifact storage, proof material, and presentation layer concerns.
- Maintain reproducibility as a first-class requirement.
- Design so an external auditor can understand the chain of evidence.

## 14. Active decisions
- **2026-02-21**: Switched verification comparison from binary hash matches to token-based Jaccard similarity (Bag-of-Words) to allow natural semantic variations in loose triage contexts.
- **2026-03-27**: Pivoted from a generic blockchain fingerprint registry to a specialized clinical audit and integrity platform ("Medical MVP").
- **2026-04-19**: Upgraded demographic profiles from flat "age/sex" properties to structured, inclusive, and PHI-aware `PatientContext`.
- **2026-05-21**: Integrated Layer 9 Sparse Autoencoder (SAE) Latent Concept auditing to transition from surface behavioral testing to direct neural verification.
- **2026-05-22**: Fixed triage UI clinician decision amendments to validate manual inputs relative to active clinician overrides instead of static baselines, and resolved red-flag deduplication.
- **2026-05-23**: Decided to retain Ollama and live LLM integration as a core requirement. True behavioral auditing, Jaccard drift detection, and SAE neural analysis require a non-deterministic generative model to produce real-world clinical variations. We maintain a dual-mode testing framework: offline deterministic mock mode for developer convenience/testing, and live generative mode (Ollama/APIs) for clinical validation.
- **2026-05-26**: Recalibrated ESI-1 and ESI-2 safety floor boundaries to `0.65` and implemented percentage-based pain mapping (`Pain: 80%`) to neutralize the high-frequency token centering artifact of raw numeric digits like `0/10` in dense embedding spaces.

## 15. Open questions
- How to scale offline C2PA verification certificates for hospital environments with intermittent external network connectivity?
- How to mathematically prove immunity to extremely slow, iterative baseline poisoning attacks without manual auditor checkpoints?
- What is the optimal ROC calibration curve to minimize false positives in multi-lingual medical triage environments?

## 16. Next priority tasks
1. **Unified Baseline-then-Audit Workflow**: Merge `BehavioralRegistration` and `BehavioralVerification` into a single, cohesive React view.
2. **Automated PHI Masking Engine**: Build automated text parsing guardrails within `EventService` to strip PII before hashing.
3. **Dynamic Lexical Drift Monitoring (v1)**: Compute continuous per-agent drift scores ($1 - \text{mean Jaccard}$) across historical encounters and graph trends.
4. **Interactive Evidence Timeline**: Build a beautiful timeline trace in the `MedicalAuditDashboard` for clinicians to explore block-chain anchors and history.

## 17. Session handoff
Read first on resume:
- This file (`PROJECT_MEMORY.md`)
- [[AI Fingerprinting - Master Note]]
- The latest progress log in [[02_Log/2026-05-22 - Triage UI Drawer, Decision Amendments, and Layer 9 SAE Panel Overhaul]]

Do not re-open by default unless needed:
- Older exploratory notes
- Archived alternatives
- Long-form research digests

Best next action:
- Consolidate the behavioral registration and drift verification components into a single Unified Baseline & Audit Component under `src/components/`.

Known “don’t lose this” context:
- **Homograph Safety**: If homograph characters are detected, the perturbation scorer MUST drop verification confidence to exactly 0%, regardless of similarity percentages.
- **ACS Acuity Fallbacks**: If the patient's sex is marked as `unknown`, the safety-grade rule engine must err on the side of caution and apply male risk thresholds (age 40) for chest pain acuity.

## 18. Canon notes
- [[AI Fingerprinting - Master Note]]
- [[AI Fingerprinting - Current Phase]]
- [AI Fingerprinting - Architecture](obsidian://open?vault=Obsidian-vault&file=AI%20Fingerprint%2FAI%20Fingerprinting%20-%20Architecture)
- [AI Fingerprinting - Crypto Design](obsidian://open?vault=Obsidian-vault&file=AI%20Fingerprint%2FAI%20Fingerprinting%20-%20Crypto%20Design)
- [[AI Fingerprinting - Blockchain Anchoring]]
- [[AI Fingerprinting - Threat Model]]
- [[AI Fingerprinting - Medical Audit Reuse]]
- [[AI Fingerprinting - Decision Log]]
- [[AI Fingerprinting - Latest Log]]

## 19. Antigravity operating rules
When working on this project:
- Read this file first.
- Restate what is being verified before proposing architecture.
- Explicitly distinguish evidence, attestation, anchor, and policy judgment.
- Before implementing, identify what claim the code will make possible.
- After implementation, state what changed in verification capability.
- Write long discussion into linked Obsidian notes, not this file.
- Keep this file concise; summarize instead of accreting history.
- Avoid overly qualitative language using terms such as 
	  - absolutely breathtaking
	  - This is an **incredible live engineering finding** and a perfect demonstration of **clinical vector calibration** in real-time!
	  - This is an **absolutely brilliant and highly robust upgrade**!
	  - We have some **incredibly profound** results!
	  - Perfect!
	  - Prepare to be fascinated:
	  - the results are spectacular.

