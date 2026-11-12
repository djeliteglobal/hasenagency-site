#!/usr/bin/env node
// Three cases against the WhatsApp worker: ampersand, truncated tag, both.
// Runs the handler locally with a stubbed NVIDIA NIM response, so nothing
// has to be deployed (and no test hook lives in the production worker).
//
//   node workers/webhook-cases.test.mjs [path/to/whatsapp-webhook.js]
//   node workers/webhook-cases.test.mjs --serve   (local harness for webhook-test.html)

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const serve = process.argv.includes('--serve');
const workerPath = process.argv.slice(2).find((a) => !a.startsWith('--'))
  ?? new URL('./whatsapp-webhook.js', import.meta.url);
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

// Local harness: same worker + stubbed NIM, but over HTTP so a browser page
// (workers/webhook-test.html) can drive it. The __test_nim field is read here,
// in the local server — the production worker has no such hook.
if (serve) {
  const port = Number(process.env.PORT || 8788);
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain' });
      res.end('Method not allowed');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || 'application/x-www-form-urlencoded';
    const parsed = await new Response(raw, { headers: { 'content-type': contentType } }).formData();

    const stub = parsed.get('__test_nim');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: stub || '' } }] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error('unexpected fetch: ' + url);
    };
    try {
      const fd = new FormData();
      for (const [k, v] of parsed.entries()) {
        if (k !== '__test_nim') fd.append(k, v);
      }
      const out = await worker.fetch(
        new Request('http://localhost/api/whatsapp', { method: 'POST', body: fd }),
        { NVIDIA_NIM_BASE_URL: 'http://nim.local', NVIDIA_NIM_API_KEY: 'stub', NVIDIA_NIM_MODEL: 'stub' },
        {}
      );
      const text = await out.text();
      res.writeHead(out.status, { 'content-type': out.headers.get('content-type') || 'text/xml' });
      res.end(text);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('error: ' + e);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  server.listen(port, () => {
    console.log(`local webhook harness on http://localhost:${port}/api/whatsapp`);
  });
} else {

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

}
