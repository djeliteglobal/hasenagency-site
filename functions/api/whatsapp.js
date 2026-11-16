import worker from '../../workers/whatsapp-webhook.js';

// Same handler as the standalone worker (workers/whatsapp-webhook.js), served
// by Pages at /api/whatsapp so the domain keeps answering Twilio even when the
// worker route is not bound to the zone.
export async function onRequest(context) {
  return worker.fetch(context.request, context.env, context.ctx);
}
