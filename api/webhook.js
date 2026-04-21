module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  try {
    const rawBody = await getRawBody(req);
    const stripe = await getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  if (event.type === 'checkout.session.completed') {
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
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const { data: profile } = await sb.from('profiles')
      .select('id').eq('stripe_subscription_id', subscription.id).single();
    if (profile) {
      await sb.from('profiles').update({
        plan: 'free',
        subscription_status: 'cancelled',
        stripe_subscription_id: null
      }).eq('id', profile.id);
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

async function getStripe() {
  const stripe = require('stripe');
  return stripe(process.env.STRIPE_SECRET_KEY);
}
