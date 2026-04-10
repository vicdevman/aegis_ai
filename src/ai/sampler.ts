import Groq from 'groq-sdk';
import { AIDecision, AIDecisionSchema } from './types.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

const groq = new Groq({ apiKey: config.groqApiKey });

async function sampleDecision(prompt: string, seed: number): Promise<AIDecision[] | null> {
  try {
    logger.debug(`[AI] 📡 Sampling with seed ${seed}...`);
    const response = await groq.chat.completions.create({
      model: config.CurrentModel,
      messages: [
        { role: 'system', content: 'Output ONLY valid JSON. Use {"decisions": [...]} format. No markdown.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      seed,
      response_format: { type: 'json_object' }
    });
    const content = response.choices[0]?.message?.content || '{}';
    logger.debug(`[AI] Sample raw: ${content}`);
    const parsed = JSON.parse(content);
    let decisions = [];
    if (Array.isArray(parsed)) decisions = parsed;
    else if (parsed.decisions && Array.isArray(parsed.decisions)) decisions = parsed.decisions;
    else return null;

    const valid = decisions.filter((d: any) => AIDecisionSchema.safeParse(d).success);
    logger.debug(`[AI] Sample → ${valid.length} valid decisions`);
    return valid;
  } catch (err) {
    logger.error(`[AI] ❌ Sample failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// Single sample only – no consensus, no 3 parallel calls
export async function getSampledDecisions(prompt: string): Promise<AIDecision[][]> {
  logger.debug('[AI] Single sample (rate limit friendly)');
  const result = await sampleDecision(prompt, 1);
  return result ? [result] : [];
}