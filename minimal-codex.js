#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');

const prompt = process.argv.slice(2).join(' ');

if (!prompt) {
  console.error('Usage: node minimal-codex.js "your prompt here"');
  process.exit(1);
}

const codex = spawn('codex', [
  'exec',
  '--output-format', 'json',
  prompt
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

const rl = readline.createInterface({
  input: codex.stdout,
  crlfDelay: Infinity
});

let hasOutput = false;

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const event = JSON.parse(line);

    // Codex: thread.started, item.completed, thread.completed...
    if (event.type === 'item.completed' && event.item) {
      const item = event.item;

      if (item.type === 'message' && item.role === 'assistant') {
        const content = item.content ?? item.message ?? '';

        if (typeof content === 'string') {
          hasOutput = true;
          process.stdout.write(content);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            const text = block?.text ?? block?.value;
            if (text) {
              hasOutput = true;
              process.stdout.write(text);
            }
          }
        }
      }
    }
  } catch {
    // ignore malformed JSON
  }
});

codex.stderr.on('data', (d) => process.stderr.write(d));

codex.on('error', (err) => {
  console.error('Failed to spawn Codex:', err.message);
  process.exit(1);
});

codex.on('close', (code) => {
  rl.close();
  if (!hasOutput && code === 0) {
    console.error('[No output from Codex]');
  }
  process.exit(code ?? 1);
});
