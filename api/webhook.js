const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      const plan = session.metadata?.plan || 'pro';
      if (userId) {
        await sb.from('profiles').update({
          plan,
          subscription_status: 'active',
          stripe_subscription_id: session.subscription || null,
          updated_at: new Date().toISOString()
        }).eq('id', userId);
        console.log(`User ${userId} upgraded to ${plan}`);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const { data: profile } = await sb.from('profiles')
        .select('id').eq('stripe_subscription_id', subscription.id).single();
      if (profile) {
        await sb.from('profiles').update({
          plan: 'free',
          subscription_status: 'cancelled',
          stripe_subscription_id: null
        }).eq('id', profile.id);
        console.log(`User ${profile.id} subscription cancelled`);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`Payment failed for customer: ${invoice.customer}`);
      break;
    }
  }

  return res.status(200).json({ received: true });
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
