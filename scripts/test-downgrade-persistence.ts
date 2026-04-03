import { TriageService } from '../src/services/triage.service';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function test() {
  const service = new TriageService(pool);
  const sessionId = 'dr._desq_005aeec0-991e-4699-b678-d152f9f59a51';
  console.log('Testing downgrade for session:', sessionId);
  
  await service.logClinicianAction(sessionId, 'downgraded', 'senior_review', 'Testing persistence', 4);
  
  const res = await pool.query("SELECT clinical_data FROM agent_events WHERE session_id = $1 AND clinician_action = 'downgraded' ORDER BY id DESC LIMIT 1;", [sessionId]);
  console.log('Saved payload result:', JSON.stringify(res.rows[0].clinical_data, null, 2));
}

test().then(() => pool.end()).catch(e => { console.error(e); pool.end(); });
