# End-to-End Testing Guide: Agent Activation Audit Trail

Use the following steps to manually verify the clinical-grade append-only activation audit trail in your local development environment.

---

## Phase 1: Environment & Setup

1. **Switch to the Feature Branch:**
   Make sure you are on the correct branch:
   ```bash
   git checkout feat/agent-activation-audit-trail
   ```

2. **Apply Local Migrations:**
   Ensure the `is_active` column and the audit trail database schema exist in your local Postgres instance:
   ```bash
   node scripts/migrate-activation-audit.js
   ```

---

## Phase 2: Start the Services

Start the containerized local development stack:
```bash
docker-compose up --build
```
> [!NOTE]
> The database migration script will execute automatically on container boot via `docker-entrypoint.sh` to configure the database internal schema.

---

## Phase 3: E2E Verification Workflow

### 1. Initial State Check
* Open your browser and navigate to `http://localhost`.
* Go to the **AI Agent Governance Directory** page.
* Confirm that a navigation tab named **Activation Trail** is now visible.
* Click the **Activation Trail** tab and verify it displays an empty history table.

### 2. Successful Agent Swapping
* Return to the **Active Directory** list.
* Locate any registered agent that is **not** currently active (labeled "Idle").
* Click the **`⚡ Activate`** button on its card.
* Verify that a modal pops up showing the target agent's details (Name, Version, Operational ID, and Fingerprint Hash) and prompts for a **Reason for Change**.
* Try to submit without a reason; the confirm button should be disabled.
* Input a valid justification reason, for example:
  > *"Swapping to Ollama Llama3 model for improved cardiology classification metrics."*
* Click **Confirm Activation**.

### 3. Verification of Success Indicators
* Verify that a green success banner is displayed at the top:
  > `🟢 Active Agent Swapped Successfully`
  > `Agent [Name] was activated by System Dashboard at [Timestamp].`
* Check that the banner displays a numeric **Audit ID** and a unique **Request ID** (correlation key).
* Confirm that the target agent's card status has transitioned to `🟢 Active / Online`, and the previously active agent has reverted to `Idle`.

### 4. Audit Trail Ledger Check
* Click the **Activation Trail** tab.
* Verify that a new **Success** log has been appended at the top of the table.
* Ensure the row correctly displays:
  * The UTC timestamp and ID.
  * The authenticated actor (`System Dashboard` / `System Service`).
  * The target agent and the previous active agent.
  * Your entered reason.
  * The outcome (`Success`).
  * The exact correlation **Request ID** shown on the success banner.

---

## Phase 4: API Failure Auditing

This step verifies that errors are properly audited outside the database transaction scope:

1. **Locate a revoked agent:**
   Find an agent in the registry marked `🔒 Permanent Revocation Anchored` (or revoke an active one to lock it). Note its `fingerprint_hash`.
    Open a terminal and run `curl` to try to activate the revoked agent, bypassing frontend UI guards (replace `YOUR_API_KEY` with the `API_KEY` value from your `.env` file):
    ```bash
    curl -X POST http://localhost/v1/agents/activate \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -H "X-Request-ID: test-failure-correlation-123" \
      -d '{"fingerprintHash": "YOUR_REVOKED_AGENT_HASH", "reason": "Hacker bypass attempt"}'
    ```
3. **Verify API Error Output:**
   * Confirm the server returns a `500 Internal Error` response containing:
     `Cannot activate revoked agent [agent_id]`
   * Verify the response headers include `X-Request-ID: test-failure-correlation-123`.
4. **Verify Failure Logging:**
   * Return to the UI's **Activation Trail** tab and click **Refresh Trail**.
   * Verify that a red **Failed** audit log has been appended at the top of the table.
   * Confirm that it shows:
     * Outcome: `Failed`
     * Target Agent ID.
     * Justification: `"Hacker bypass attempt"`
     * Correlation Context: `test-failure-correlation-123`
     * Error Details: `"Cannot activate revoked agent..."` in the metadata column.
