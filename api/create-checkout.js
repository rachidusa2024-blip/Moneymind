module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { plan } = req.body;
  const priceId = plan === 'lifetime'
    ? process.env.STRIPE_LIFETIME_PRICE_ID
    : process.env.STRIPE_PRO_PRICE_ID;
  const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://sumgoals.com';
  const secretKey = process.env.STRIPE_SECRET_KEY;

  const params = new URLSearchParams({
    'payment_method_types[]': 'card',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'mode': plan === 'lifetime' ? 'payment' : 'subscription',
    'success_url': baseUrl + '/success.html',
    'cancel_url': baseUrl + '/dashboard.html',
    'allow_promotion_codes': 'true',
  });

  if (plan === 'pro') {
    params.append('discounts[0][coupon]', 'FIRST1');
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + secretKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString()
  });

  const session = await response.json();
  if (session.error) return res.status(500).json({ error: session.error.message });
  return res.status(200).json({ url: session.url });
};
