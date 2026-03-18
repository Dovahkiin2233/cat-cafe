#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');

const prompt = process.argv.slice(2).join(' ');

if (!prompt) {
  console.error('Usage: node minimal-claude.js "your prompt here"');
  process.exit(1);
}

const claude = spawn('claude', [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--verbose'
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

const rl = readline.createInterface({
  input: claude.stdout,
  crlfDelay: Infinity
});

let hasOutput = false;

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const event = JSON.parse(line);

    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          hasOutput = true;
          process.stdout.write(block.text);
        }
      }
    }
  } catch {
    // ignore malformed JSON
  }
});

claude.stderr.on('data', (d) => process.stderr.write(d));

claude.on('error', (err) => {
  console.error('Failed to spawn Claude:', err.message);
  process.exit(1);
});

claude.on('close', (code) => {
  rl.close();
  if (!hasOutput && code === 0) {
    console.error('[No output from Claude]');
  }
  process.exit(code ?? 1);
});
