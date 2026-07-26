import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const route = fs.readFileSync(path.join(root, 'routes/applicationAi.js'), 'utf8');
const provider = fs.readFileSync(path.join(root, 'services/openrouter.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

describe('runtime OpenRouter acceptance path', () => {
  it('is mounted below authentication and persists the provider receipt', () => {
    expect(index.indexOf("app.use('/api', authMiddleware)")).toBeLessThan(index.indexOf("app.use('/api/application-ai'"));
    expect(route).toMatch(/RuntimeAiResult\.create/);
    expect(route).toMatch(/providerReceipt/);
  });
  it('uses the exact configured OpenRouter base without empty fallback content', () => {
    expect(provider).toMatch(/OPENROUTER_BASE_URL/);
    expect(provider).toMatch(/https:\/\/openrouter\.ai\/api\/v1/);
    expect(provider).toMatch(/OPENROUTER_INCOMPLETE/);
    expect(provider).not.toMatch(/No response from AI/);
  });
});
