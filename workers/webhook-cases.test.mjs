#!/usr/bin/env node
// Three cases against the WhatsApp worker: ampersand, truncated tag, both.
// Runs the handler locally with a stubbed NVIDIA NIM response, so nothing
// has to be deployed (and no test hook lives in the production worker).
//
//   node workers/webhook-cases.test.mjs [path/to/whatsapp-webhook.js]

import { readFile } from 'node:fs/promises';

const workerPath = process.argv[2] ?? new URL('./whatsapp-webhook.js', import.meta.url);
const src = await readFile(workerPath, 'utf8');
const { default: worker } = await import(
  'data:text/javascript;base64,' + Buffer.from(src).toString('base64')
);

const AMP = 'Dentists lose ~$4k/mo to missed calls & no-shows.\n1. CAPTURE: forward after-hours calls to AI\n2. CONVERT: books straight into your calendar\n3. FOLLOW-UP: reminders cut no-shows';
const TRUNC = '1. CAPTURE: forward after-hours calls to AI <2. CONVERT: books straight into your calendar';
const BOTH = AMP + ' <b>broken';

const CASES = [
  { name: 'amp', payload: AMP, expect: ['&amp;'] },
  { name: 'trunc', payload: TRUNC, expect: ['&lt;'] },
  { name: 'both', payload: BOTH, expect: ['&amp;', '&lt;'] },
];

async function runCase(payload) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/chat/completions')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: payload } }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error('unexpected fetch: ' + url);
  };
  try {
    const fd = new FormData();
    fd.append('From', 'whatsapp:+5521999340899');
    fd.append('Body', 'SAVE');
    const res = await worker.fetch(new Request('https://hasenagency.site/api/whatsapp', { method: 'POST', body: fd }), {}, {});
    const xml = await res.text();
    const match = xml.match(/<Message>([\s\S]*?)<\/Message>/);
    return match ? match[1] : '';
  } finally {
    globalThis.fetch = originalFetch;
  }
}

let failures = 0;

for (const c of CASES) {
  const msg = await runCase(c.payload);
  const problems = [];

  if (msg.includes('<') || msg.includes('>')) problems.push('raw angle brackets in Message');
  if (msg.replace(/&(amp|lt|gt|quot|apos);/g, '').includes('&')) problems.push('unescaped ampersand');
  for (const e of c.expect) if (!msg.includes(e)) problems.push(`missing ${e}`);
  if (!msg.includes('CAPTURE')) problems.push('recovery plan steps were cut off');

  if (problems.length) {
    failures++;
    console.log(`FAIL ${c.name}: ${problems.join('; ')}\n     ${msg.slice(0, 160)}`);
  } else {
    console.log(`PASS ${c.name}`);
  }
}

console.log(failures ? `\n${failures}/${CASES.length} cases failed` : `\nall ${CASES.length} cases passed`);
process.exit(failures ? 1 : 0);
