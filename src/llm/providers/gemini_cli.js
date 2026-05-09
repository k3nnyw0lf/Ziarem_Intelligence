/**
 * Gemini CLI subprocess.
 * Uses Kenneth's Google One AI Premium subscription via the local `gemini` CLI.
 * Disabled by default — only enable for ad-hoc one-shot tasks (slow, ~1-2s startup per call).
 * Programmatic batch use of an interactive subscription is conservative — keep usage modest.
 *
 * Enable: UPDATE llm_provider_quota SET enabled = TRUE WHERE provider = 'gemini-cli';
 */

const { spawn } = require('node:child_process');

const DEFAULT_MODEL = process.env.GEMINI_CLI_MODEL || 'gemini-2.5-flash';

module.exports = {
  name: 'gemini-cli',
  defaultModel: DEFAULT_MODEL,
  supportsEmbed: false,
  isConfigured: (env) => env.GEMINI_CLI_ENABLED === 'true',

  async call({ system, user, maxTokens, wantJson }) {
    const prompt = (system ? `System: ${system}\n\n` : '') + `User: ${user}` + (wantJson ? '\n\nReturn ONLY valid JSON with no prose, no markdown fences.' : '');
    const args = ['-p', prompt, '--output-format', 'text'];
    if (DEFAULT_MODEL) args.push('-m', DEFAULT_MODEL);

    return new Promise((resolve, reject) => {
      const child = spawn('gemini', args, { shell: process.platform === 'win32' });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(Object.assign(new Error(`gemini-cli exit ${code}: ${stderr.slice(0, 300)}`), { status: 500 }));
        resolve({
          text: stdout.trim(),
          model: DEFAULT_MODEL,
          tokens_in: 0,
          tokens_out: 0,
          est_cost_usd: 0,
        });
      });
    });
  },
};
