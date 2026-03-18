#!/usr/bin/env node

const { spawn } = require('child_process');

// In-memory session ids per cli (lesson 03+ can persist this to disk)
const sessions = {};

function spawnCli(cli, prompt, { resume = true } = {}) {
  const resumeId = resume !== false ? sessions[cli] : null;

  if (cli === 'claude') {
    return {
      command: 'claude',
      args: resumeId
        ? ['-p', prompt, '--resume', resumeId, '--output-format', 'stream-json', '--verbose']
        : ['-p', prompt, '--output-format', 'stream-json', '--verbose'],
      onEvent: (data) => {
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
      onEvent: (data) => {
        // Codex session id field varies; keep best-effort.
        if (data.session_id) sessions[cli] = data.session_id;
        if (data.thread_id && !sessions[cli]) sessions[cli] = data.thread_id;

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

function parseNdjsonStream(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');

  stream.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      onLine(trimmed);
    }
  });

  stream.on('end', () => {
    const trimmed = buf.trim();
    if (trimmed) onLine(trimmed);
  });
}

async function invoke(cli, prompt, opts = {}) {
  const cfg = spawnCli(cli, prompt, opts);

  const timeoutMs = Number(opts.timeoutMs ?? process.env.CLI_TIMEOUT_MS ?? 10 * 60 * 1000);
  const killAfterMs = Number(opts.killAfterMs ?? process.env.CLI_KILL_AFTER_MS ?? 5000);

  return new Promise((resolve, reject) => {
    const proc = spawn(cfg.command, cfg.args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    let lastActivity = Date.now();
    let settled = false;

    function touch() {
      lastActivity = Date.now();
    }

    // Activity on BOTH stdout/stderr (lesson 02 requirement)
    proc.stdout.on('data', touch);
    proc.stderr.on('data', touch);

    // Robust NDJSON parsing (handles partial lines / chunk coalescing)
    parseNdjsonStream(proc.stdout, (line) => {
      try {
        const data = JSON.parse(line);
        const chunk = cfg.onEvent(data);
        if (chunk) {
          process.stdout.write(chunk);
          output += chunk;
        }
      } catch {
        // Ignore malformed JSON lines in stream-json
      }
    });

    // Always forward stderr to parent for debugging
    proc.stderr.on('data', (d) => process.stderr.write(d));

    // Graceful timeout watchdog
    const timer = setInterval(() => {
      if (settled) return;
      if (Date.now() - lastActivity <= timeoutMs) return;

      // Phase 1: SIGTERM
      try {
        proc.kill('SIGTERM');
      } catch {}

      // Phase 2: SIGKILL after a grace period
      setTimeout(() => {
        if (settled) return;
        try {
          proc.kill('SIGKILL');
        } catch {}
      }, killAfterMs).unref();

      done(new Error(`${cli} timeout after ${timeoutMs}ms`));
    }, 500).unref();

    function done(err, code) {
      if (settled) return;
      settled = true;
      clearInterval(timer);

      process.stdout.write('\n');

      if (err) return reject(err);
      if (code === 0) return resolve(output);
      reject(new Error(`${cli} exited with code ${code}`));
    }

    // Parent signal cleanup (lesson 02 requirement)
    const onSig = (sig) => {
      try {
        proc.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
      }, killAfterMs).unref();
    };
    process.once('SIGINT', onSig);
    process.once('SIGTERM', onSig);

    proc.on('error', (err) => done(err));
    proc.on('close', (code) => done(null, code));
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
  const args = process.argv.slice(2);
  const cli = args[0] || 'claude';

  if (args.includes('--reset')) {
    resetSession(cli);
    console.log(`[${cli}] session reset`);
    return;
  }

  // Simple flags
  const timeoutIdx = args.indexOf('--timeout-ms');
  const timeoutMs = timeoutIdx !== -1 ? Number(args[timeoutIdx + 1]) : undefined;

  const prompt = args.slice(1).filter((x, i, arr) => {
    if (x === '--timeout-ms') return false;
    if (timeoutIdx !== -1 && i === timeoutIdx + 1) return false;
    if (x === '--reset') return false;
    return true;
  }).join(' ') || '你好，请用一句话介绍自己';

  const out = await invoke(cli, prompt, { timeoutMs });
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
