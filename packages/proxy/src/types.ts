export interface ApiKey {
  id: string;
  key: string;
  name: string;
  created_at: number;
}

export interface Trace {
  id: string;
  api_key_id: string;
  provider: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
  cost_usd: number | null;
  quality_score: number | null;
  quality_flags: string | null; // JSON string
  input: string;  // JSON string of messages array
  output: string; // assistant message content
  created_at: number;
}

export interface AlertConfig {
  id: string;
  api_key_id: string;
  threshold: number;     // e.g. 0.2 = alert when score drops 20%
  window_hours: number;
  webhook_url: string | null;
  created_at: number;
}

export interface QualityFlags {
  too_short: boolean;
  repetitive: boolean;
  refusal: boolean;
  format_mismatch: boolean;
  low_relevance: boolean;
  language_mismatch: boolean;   // prompt in DE, output in EN (or vice versa)
  verbose_padding: boolean;     // very long output but low information density
  hallucination_risk: boolean;  // specific numbers/names not present in prompt
}

export interface ScoringResult {
  score: number;          // 0.0 – 1.0
  flags: QualityFlags;
}

// OpenAI-compatible message shapes we need
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
