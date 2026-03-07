# AI Fingerprint & Agent Verification Architecture (Web3 Hybrid)

## 1. Architecture Overview (Web2.5 Gateway)

The system leverages a decentralized "Web3" identity foundation via the [AIFingerprint.sol](file:///Users/dfdumaresq/Projects/Fingerprint/contracts/AIFingerprint.sol) smart contract, while providing a fast, developer-friendly "Web2.5" REST API gateway for relying parties (like merchants or SaaS platforms).

This hybrid approach removes the friction of Web3 for integrators (no RPC endpoints, gas fees, or complex wallet connections required for merchants) while maintaining the immutable, decentralized nature of the Agent Registry.

There are four main pillars:

1. **Smart Contract Registry ([AIFingerprint.sol](file:///Users/dfdumaresq/Projects/Fingerprint/contracts/AIFingerprint.sol))**: The ultimate source of truth deployed on Ethereum (or an L2). It binds an agent's details (id, name, version) to a `fingerprintHash` (credential ID), an Ethereum owner address (`registeredBy`), and tracks trait hashes (`traitHash`) for behavioral validation and revocations.
2. **Blockchain Indexer & Cache**: A backend service that listens for contract events (`FingerprintRegistered`, `BehavioralTraitRegistered`, `FingerprintRevoked`) and builds a high-speed read replica database.
3. **Verification / Decision Engine**: The runtime API brain. It ingests verification requests from merchants, queries the indexed data (or direct RPC for critical checks), validates cryptographic signatures or behavioral response patterns (`verifyBehavioralMatch`), and outputs a composite trust score and recommendation (`accept`, `challenge`, `deny`).
4. **Public API Surface**: A RESTful gateway secured via API keys for relying parties (merchants) and developers to programmatically verify agents without touching blockchain infrastructure.

**High-Level Flow (Merchant Checkout):**
1. **Registration (Asynchronous)**: An AI developer calls `registerFingerprint` on the smart contract directly (or via a relayer UI). Our Indexer picks up the event.
2. **Checkout Attempt**: An AI Agent attempts a checkout on a Merchant's site, including its `fingerprintHash` and an assertion (e.g., a short-lived signature or behavioral payload) in the HTTP headers.
3. **Verification Request**: The Merchant's backend pauses the checkout and calls our `POST /v1/agents/verify` endpoint, passing the agent's fingerprint and request context.
4. **Validation**: The Verification Engine checks the cached blockchain state. Is `exists == true`? Is `revoked == false`? Does the behavioral hash match?
5. **Decision**: The API returns `{"decision": "accept", "trust_score": 95}` based on the smart contract state and off-chain context policies.
6. **Fulfillment**: The Merchant proceeds with the checkout process.

## 2. API Design: Core Endpoints

We expose a versioned, RESTful JSON API. Relying parties (merchants) authenticate via Bearer token (API Key).

*Note: The `POST /v1/agents/register` endpoint is intentionally omitted from the core API, as registration is primarily an on-chain action. We may provide a relayer/faucet endpoint in the future, but it is not core to the verification flow.*

### `GET /v1/agents/{fingerprintHash}`
* **Purpose**: Retrieves public metadata, ownership, and current revocation status directly from the indexed smart contract state.
* **Backend Action**: Fast lookup in the Indexer DB, reflecting the latest `verifyFingerprintExtended` output.
* **Response**:
  ```json
  {
    "fingerprintHash": "0xabc123...",
    "agent_id": "agt_888",
    "name": "Acme Checkout Bot",
    "provider": "Acme Corp",
    "version": "1.0.0",
    "registeredBy": "0x71C...976F",
    "createdAt": "2026-03-01T20:00:00Z",
    "isRevoked": false,
    "behavioralTrait": {
      "hasTrait": true,
      "traitVersion": "reasoning-v1.0",
      "lastUpdatedAt": "2026-03-01T20:00:00Z"
    }
  }
  ```

### `GET /v1/agents`
* **Purpose**: List and discover active agents. Useful for SaaS platforms building whitelists based on smart contract events.
* **Parameters**: `?provider=Acme%20Corp`, `?status=active`, `?owner=0x71C...976F`
* **Response**:
  ```json
  {
    "data": [
      {
        "fingerprintHash": "0xabc123...",
        "name": "Acme Checkout Bot"
      }
    ],
    "has_more": false
  }
  ```

### `POST /v1/agents/verify`
* **Purpose**: The critical runtime endpoint for relying parties to verify an incoming agent request. This abstracts away the complexity of checking state on-chain and matching the `keccak256` behavior traits.
* **Request**:
  ```json
  {
    "fingerprintHash": "0xabc123...",
    "currentTraitPayload": "TThe sky is blue because... (Raw response from bot to hash)",
    "context": {
      "ip_address": "198.51.100.14",
      "user_agent": "AcmeBot/1.0",
      "requested_resource": "/checkout/complete"
    }
  }
  ```
* **Response**:
  ```json
  {
    "decision": "accept",
    "trust_score": 98,
    "agent": {
      "name": "Acme Checkout Bot",
      "provider": "Acme Corp"
    },
    "signals": [
      "contract_status_active",
      "behavioral_match_success"
    ],
    "recommendations": []
  }
  ```

## 3. AI Fingerprint Modeling (Decentralized Identity)

Your smart contract implements a concrete version of Decentralized Identity (equivalent to Option B in the previous design). 

**The Cryptographic Model:**
*   **The Credential ID**: The `fingerprintHash`.
*   **The Organization Owner**: The Ethereum address (`msg.sender` / `registeredBy`).
*   **The Attestation**: The `traitHash` (a `keccak256` hash of typical behavioral responses).

**How it works in practice:**
Unlike simple Web2 JWTs, this design relies heavily on behavioral validation or secure enclaves. Since an agent can't easily sign runtime transactions with an Ethereum wallet every time it makes an HTTP request to a merchant (it would be slow and require the private key in memory), it proves its identity via its **Behavioral Trait Payload**.

The Merchant passes a snippet of the Agent's recent reasoning or standardized challenge response to our API (`currentTraitPayload`). Our API hashes it, checks if the agent is active/unrevoked on the smart contract, and compares the hashes.

## 4. Verification Flow Details

**Scenario: Merchant Checkout API**

```text
 1. [Agent Dev] Deploys/Registers Agent via smart contract `registerFingerprint()` and `registerBehavioralTrait()`.
 2. [Indexer] API backend detects `FingerprintRegistered` event, caches data.
 3. [Agent] Attempts checkout at Merchant, providing `X-AI-FingerprintHash: 0xabc123` header.
    (Optional: Merchant requires agent to answer a quick 'challenge' prompt to generate a payload).
 4. [Merchant] Pauses checkout processing.
 5. [Merchant] Sends an API Key authenticated POST to Fingerprint API `POST /v1/agents/verify`.
    Passes `fingerprintHash`, IP context, and the Agent's raw behavioral challenge payload.
 6. [Fingerprint API] 
     a. Performs fast lookup in Indexer DB for `0xabc123`.
     b. Checks revocation status: `isRevoked() == false`.
     c. Hashes raw payload and compares against on-chain `traitHash`.
     d. Evaluates Risk: IP reputation, velocity. computes `trust_score`.
 7. [Fingerprint API] Returns JSON response {'decision': 'accept', 'trust_score': 98} to Merchant.
 8. [Merchant] Reads `decision`. Since it is "accept", Merchant finalizes the checkout.
```

## 5. Quick Wins vs. Longer-Term Roadmap

### Quick Wins / MVP (Weeks 1-4)
* **The Indexer**: Build a robust script (e.g. Node.js + Ethers/Viem) to listen for the 5 key events in [AIFingerprint.sol](file:///Users/dfdumaresq/Projects/Fingerprint/contracts/AIFingerprint.sol) and populate a Redis cache or Postgres DB.
* **Core API Gateway**: Implement `GET /v1/agents/{hash}` and `POST /v1/agents/verify`.
* **Behavioral Matching Engine**: Implement the off-chain `keccak256` hashing logic to match the `verifyBehavioralMatch()` contract function without requiring gas.
* **Developer SDK**: Provide a Node/Python SDK for Merchants to call the Verification API.

### Phase 2+ Enhancements
* **Relayer API**: Add a `POST /v1/agents/register` endpoint that acts as a meta-transaction relayer, allowing Agent Devs to pay via credit card while we sponsor the gas to write to the Ethereum smart contract.
* **Cross-Chain Deployments**: Deploy [AIFingerprint.sol](file:///Users/dfdumaresq/Projects/Fingerprint/contracts/AIFingerprint.sol) to L2s (Base, Arbitrum) and have the Indexer aggregate across networks.
* **Dynamic Risk Engine**: Augment the smart contract's binary (Active/Revoked) state with off-chain ML scoring based on IP velocity and success rates.
* **Zero-Knowledge Proofs**: Allow the agent to compute the `keccak256(currentTraitHash)` locally and submit a ZK-proof, avoiding the need to send raw behavioral payloads to the Merchant.

## 6. Developer Experience and Examples

### OpenAPI Snippet (`POST /v1/agents/verify`)
```yaml
paths:
  /v1/agents/verify:
    post:
      summary: Verify an AI agent fingerprint using Web3 constraints
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [fingerprintHash]
              properties:
                fingerprintHash:
                  type: string
                  description: The unique hex string identifying the agent on the smart contract.
                currentTraitPayload:
                  type: string
                  description: Raw behavioral text to be hashed and compared against the contract's traitHash.
                context:
                  type: object
                  properties:
                    ip_address: { type: string }
      responses:
        '200':
          description: Verification result
          content:
            application/json:
              schema:
                type: object
                properties:
                  decision:
                    type: string
                    enum: [accept, challenge, deny]
                  trust_score:
                    type: integer
```

### Example cURL: Merchant Verifying an Agent
```bash
curl -X POST https://api.fingerprint.ai/v1/agents/verify \
  -H "Authorization: Bearer sk_live_merchant123" \
  -H "Content-Type: application/json" \
  -d '{
    "fingerprintHash": "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "currentTraitPayload": "My reasoning step 1: Assess cart total. Step 2: Validate shipping.",
    "context": {
      "ip_address": "203.0.113.45"
    }
  }'
```

## 7. Assumptions & Clarifications
1. **Contract Immutability**: The [AIFingerprint.sol](file:///Users/dfdumaresq/Projects/Fingerprint/contracts/AIFingerprint.sol) contract is deployed and functioning accurately. We assume the indexer can connect to a reliable RPC node.
2. **Behavioral Hashing**: The `verifyBehavioralMatch()` function expects a `currentTraitHash`. We assume the API gateway will handle the actual `keccak256` conversion of raw text payloads (`currentTraitPayload`) provided by merchants.
3. **Registration Flow**: Agent creators interact directly with the blockchain DApp/Contract to register new fingerprints. The API only reads and verifies them for Merchants. 
4. **Gas Costs**: Merchants avoid gas costs completely by querying the API, which queries its synced Indexer DB (not RPC).
