#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');

const sessions = {}; // in-memory session ids per cli

function spawnCli(cli, prompt, { resume = true } = {}) {
  const resumeId = resume !== false ? sessions[cli] : null;

  if (cli === 'claude') {
    return {
      command: 'claude',
      args: resumeId
        ? ['-p', prompt, '--resume', resumeId, '--output-format', 'stream-json', '--verbose']
        : ['-p', prompt, '--output-format', 'stream-json', '--verbose'],
      parseLine: (data) => {
        if (data.session_id) sessions[cli] = data.session_id;
        if (data.type === 'assistant' && data.message?.content) {
          let text = '';
          for (const block of data.message.content) {
            if (block.type === 'text' && block.text) text += block.text;
          }
          return text || null;
        }
        return null;
      }
    };
  }

  if (cli === 'codex') {
    return {
      command: 'codex',
      args: resumeId
        ? ['exec', '--output-format', 'json', '--resume', resumeId, prompt]
        : ['exec', '--output-format', 'json', prompt],
      parseLine: (data) => {
        if (data.session_id) sessions[cli] = data.session_id;
        if (data.type === 'item.completed' && data.item?.type === 'message' && data.item.role === 'assistant') {
          const content = data.item.content ?? data.item.message ?? '';
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) {
            return content.map((b) => b?.text ?? b?.value).filter(Boolean).join('') || null;
          }
        }
        return null;
      }
    };
  }

  throw new Error(`Unknown cli: ${cli}`);
}

async function invoke(cli, prompt, opts = {}) {
  const cfg = spawnCli(cli, prompt, opts);

  return new Promise((resolve, reject) => {
    const proc = spawn(cfg.command, cfg.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';

    const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const data = JSON.parse(line);
        const chunk = cfg.parseLine(data);
        if (chunk) {
          process.stdout.write(chunk);
          output += chunk;
        }
      } catch {
        // ignore
      }
    });

    proc.stderr.on('data', (d) => process.stderr.write(d));

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      rl.close();
      process.stdout.write('\n');
      if (code === 0) return resolve(output);
      reject(new Error(`${cli} exited with code ${code}`));
    });
  });
}

function resetSession(cli) {
  if (cli) delete sessions[cli];
  else Object.keys(sessions).forEach((k) => delete sessions[k]);
}

function getSession(cli) {
  return sessions[cli];
}

async function main() {
  const cli = process.argv[2] || 'claude';
  const prompt = process.argv.slice(3).join(' ') || '你好，请用一句话介绍自己';

  if (process.argv.includes('--reset')) {
    resetSession(cli);
    console.log(`[${cli}] session reset`);
    return;
  }

  const out = await invoke(cli, prompt);
  console.log(`\n[${cli}] output chars: ${out.length}`);
  console.log(`[${cli}] session: ${getSession(cli) || '(none)'}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

module.exports = { invoke, resetSession, getSession };
