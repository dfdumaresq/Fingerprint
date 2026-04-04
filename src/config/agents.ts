/**
 * src/config/agents.ts
 * 
 * Single source of truth for the active AI triage agent.
 * Swap `provider` to change the backend without touching any other file.
 */

export type TriageAgentProvider = 'rules' | 'ollama' | 'anthropic' | 'openai';

export interface TriageAgentConfig {
  /** Matches the fingerprint_hash in the agents table */
  id: string;
  name: string;
  provider: TriageAgentProvider;
  /** Model identifier, e.g. "llama3:8b" or "gpt-4.1-mini" */
  model: string;
  /** Base URL for Ollama or OpenAI-compatible endpoints */
  endpoint?: string;
  temperature?: number;
}

export const TRIAGE_AGENT: TriageAgentConfig = {
  id: "0x28f2ed93f69f9f78460fe13bfcba66eb77018034146aa4a76c0a2d1630db4a97",
  name: "TriageBot (Ollama · llama3:8b)",
  provider:
    (process.env.TRIAGE_AGENT_PROVIDER as TriageAgentProvider) || "ollama",
  model: process.env.TRIAGE_AGENT_MODEL || "llama3:8b",
  endpoint: process.env.OLLAMA_ENDPOINT || "http://localhost:11434",
  temperature: 0,
};
