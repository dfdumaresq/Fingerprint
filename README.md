# Medical AI Audit Ledger & Behavioral Verification Platform

A medical AI integrity platform designed to make triage and clinical review work easier to trust, easier to audit, and easier to act on.

This project began as an AI agent fingerprinting system and has evolved into a broader audit-and-integrity platform for healthcare-adjacent AI. Today, the emphasis is not just on proving that an AI system is identifiable, but on helping nurses, clinicians, reviewers, and operations teams understand what the system did, why it did it, whether it can be trusted, and when its output should be escalated or questioned.

## Overview

The platform now supports three closely related capabilities:

1. **Clinical Audit & Triage**: Surfaces AI-assisted workflow activity through dashboards built for triage review, operational monitoring, and medical audit workflows.
2. **Behavioral Verification**: Registers, compares, and verifies agent traits and behavioral signatures to detect drift, impersonation, or unexpected changes in system behavior.
3. **Tamper-Evident Integrity**: Preserves verifiable records, provenance signals, and integrity metadata so developers and reviewers can detect altered outputs, broken evidence chains, or compromised execution flows.

In practice, the project functions less like a simple fingerprint registry and more like a medical AI audit ledger backed by behavioral verification and trust primitives.

## Clinical UX Goals

This system is being shaped for environments where clarity, speed, and confidence matter.

The product direction is intended to support work such as:

- Reducing the cognitive overhead of reviewing AI-assisted triage outputs.
- Making handoffs between systems, reviewers, and clinicians easier to understand.
- Surfacing confidence, provenance, and integrity signals without forcing users to dig through technical logs.
- Helping operators know when to trust, verify, escalate, or override AI-generated recommendations.
- Preserving auditability without turning the experience into a compliance-first interface.

For designers and developers with healthcare experience, this means the opportunity is not only to improve interface polish, but to shape how trust, reviewability, and workload reduction appear inside real clinical workflows.

## Current Project State

The repository should be understood as a **Medical AI Audit & Integrity** application with an underlying AI fingerprint and verification layer.

The original blockchain-centric fingerprinting model is still relevant, but it is now one part of a larger product surface that includes:

- Clinical workflow dashboards (`TriageDashboard`, `MedicalAuditDashboard`).
- Behavioral verification logic (Triage vs. Enforcement modes).
- Tamper demonstration scripts.
- API documentation and OpenAPI definitions.
- Security and provenance controls (C2PA).

## Core Capabilities

### Clinical Audit & Triage

The clinical side of the platform is focused on operational transparency and reviewability.

Key interfaces include:

- **TriageDashboard**: A workflow-oriented view for reviewing AI-assisted triage outputs, monitoring case flow, and surfacing decision-support context.
- **MedicalAuditDashboard**: A review surface for tracing system actions, validating evidence, and inspecting medical AI activity over time.

### Behavioral Audit

The behavioral verification layer is used to register and validate expected traits of an AI agent or workflow.

- **Establishing Baselines**: Create a behavioral signature for a known-good model.
- **Drift Detection**: Detect changes in system persona or logic during auditing.
- **Audit Modes**: Supports loose “Triage” matching (high sensitivity) and strict “Enforcement” matching (identity verification).

### Tamper Demonstration

The repository includes a tamper demonstration workflow to help developers and reviewers understand how integrity protections behave under manipulation.

```bash
npm run demo:tamper
```

This demonstration shows how clinical evidence can be altered, how tamper signals are surfaced, and how the platform distinguishes trusted records from compromised ones.

### OpenAPI Specification

The project exposes API documentation for integration, testing, and onboarding.

- **Swagger UI**: Access at `http://localhost:3000/api-docs` when the server is running.
- **OpenAPI definition**: Located at `src/api/openapi.yaml`.

## Technologies Used

- **Frontend**: React 19, TypeScript, Vanilla CSS (Glassmorphism).
- **Backend**: Node.js, Express 5.
- **Database**: PostgreSQL (Audit records), Redis (Caching/Ephemeral state).
- **Integrity**: C2PA (`@trustnxt/c2pa-ts`), EIP-712 Typed Signatures.
- **Blockchain**: Solidity, Ethers.js 6, Hardhat (Foundational layer).

## Running the Application

### 1. Initialize Supporting Services

Ensure PostgreSQL and Redis are running locally or accessible via your `.env` configuration.

### 2. Start the Platform

To run the full Medical AI Audit environment:

```bash
# Initialize the database and start the API server
npm run dev:medical

# (Optional) Start the frontend development server
npm start
```

### 3. Generate Sample Data

To populate the dashboards with simulated clinical events:

```bash
npm run simulate:medical
```

## Developer Workflow

For a second developer joining the project, this is the recommended mental model:

1. **Explore the Dashboards**: Understand the triage and medical audit views first.
2. **Review the API Contract**: Inspect `http://localhost:3000/api-docs`.
3. **Understand the Integrity Model**: Trace how behavioral verification and C2PA provenance work together.
4. **Run the Tamper Demonstration**: Use `npm run demo:tamper` to see detection paths in action.

## Security

Security emphasizes **audit integrity** and **tamper-evident evidence handling**:

- **Tamper Evidence**: All ledger entries are cryptographically linked; breaking the chain triggers visual alerts.
- **Provenance**: C2PA metadata establishes source and transformation history for all clinical evidence.
- **Behavioral Verification**: Identity is verified not just by keys, but by consistent behavioral signatures.

## License

[MIT License](LICENSE)
