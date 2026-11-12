export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const formData = await request.formData();
    const from = formData.get('From'); // whatsapp:+5521999340899
    const body = (formData.get('Body') || '').trim().toUpperCase();
    const messageSid = formData.get('MessageSid');

    if (!from || !body) return new Response('Missing params', { status: 400 });

    // Only respond to SAVE keyword (case insensitive)
    if (body !== 'SAVE') {
      // Optional: log non-SAVE messages for manual follow-up
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // Generate AI response using NVIDIA NIM
    const aiResponse = await generateRecoveryPlan(env);
    
    // Reply via Twilio
    const twilioResp = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(trimNimOutput(aiResponse))}</Message>
</Response>`;

    return new Response(twilioResp, { headers: { 'Content-Type': 'text/xml' } });
  }
};

async function generateRecoveryPlan(env) {
  const prompt = `You are an AI reception expert for clinics/medspas/dental. A prospect just texted "SAVE" after using our missed-call revenue calculator. They're losing money on missed calls. 

Reply in 1 short WhatsApp message (under 1600 chars). Tone: direct, expert, helpful. No fluff.

Give them a 3-step recovery plan they can implement THIS WEEK:
1. Capture: Forward missed calls to AI after hours/lunch
2. Convert: AI books appointments directly into their calendar
3. Follow-up: Automated SMS/email reminders reduce no-shows

End with: "Reply with your: business type, calls/day, avg patient value, current booking system. I'll send your custom recovery numbers."

No markdown. Plain text. Max 3 short paragraphs.`;

  const response = await fetch(`${env.NVIDIA_NIM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NVIDIA_NIM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.NVIDIA_NIM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('NIM error:', err);
    return fallbackPlan();
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || fallbackPlan();
}

function fallbackPlan() {
  return `3-step recovery plan for missed calls:

1. CAPTURE: Forward after-hours/lunch calls to AI receptionist
2. CONVERT: AI books appointments directly into your calendar  
3. FOLLOW-UP: Automated reminders cut no-shows by 40%

Reply with: business type, calls/day, avg patient value, booking system. I'll send your custom recovery numbers.`;
}

const MAX_MESSAGE_CHARS = 1600;

function trimNimOutput(s) {
  if (!s) return '';
  const cleaned = String(s).trim();
  if (cleaned.length <= MAX_MESSAGE_CHARS) return cleaned;
  const slice = cleaned.slice(0, MAX_MESSAGE_CHARS);
  const match = slice.match(/[\s\S]*[.!?](?=\s|$)/);
  return (match ? match[0] : slice).trim();
}

function escapeXml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[<>]/g, '');
}
