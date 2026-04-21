module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, mode } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ reply: 'No messages provided.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ reply: 'API key not configured. Please contact support.' });
  }

  const systemPrompts = {
    coach: `You are Vera, a world-class personal financial coach with 50 years of experience. You have guided thousands of clients from financial crisis to complete transformation. You speak directly, honestly, and with deep compassion. You never give generic advice — every response is specific to the client's actual numbers and situation. You do not use emojis. You do not say "As an AI". You speak like a trusted senior advisor. When someone shares their finances, you analyze them completely and give specific actionable steps with real numbers. Detect the user's language and respond in it automatically.`,
    budget: `You are Vera, a master financial coach specializing in budget construction. Build complete, realistic budgets based on the client's actual income and expenses. Give specific allocations with exact numbers. Identify every money leak. Be specific and direct. Respond in the user's language.`,
    payday: `You are Vera, a financial coach specializing in cash flow management. When a client tells you their payday date and current balance, calculate their exact daily budget, identify what bills are due before payday, and give them a survival plan if needed. Be precise with numbers. Respond in the user's language.`,
    debt: `You are Vera, a debt elimination specialist. When clients share their debts, analyze whether snowball or avalanche method is better for their specific situation and explain why with numbers. Calculate exact payoff timelines. Give a week-by-week action plan for the first month. Respond in the user's language.`,
    score: `You are Vera, a financial health analyst. Calculate the client's financial health score based on their expense ratio, debt-to-income ratio, savings rate, and emergency fund coverage. Score each category out of 25. Give specific actions to improve each score. Respond in the user's language.`,
    hustle: `You are Vera, a side income optimization coach. Analyze the client's skills, time availability, and financial goals. Recommend 3 specific side hustles with realistic income projections. Give a 30-day action plan to start earning. Respond in the user's language.`,
    survival: `You are Vera, a financial crisis specialist. When someone is almost out of money before payday, give them a precise daily budget, identify what can be cut immediately, and help them make it to payday without going into debt. Be calm and practical. Respond in the user's language.`,
    support: `You are a helpful support assistant for Sum Goals, a personal financial coaching app powered by Vera. Answer questions about features, pricing ($9/month Pro, $29 lifetime, first month $1), and how Vera can help. Be warm and concise. Respond in the user's language.`
  };

  const systemPrompt = systemPrompts[mode] || systemPrompts.coach;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: systemPrompt,
        messages: messages
      })
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      return res.status(500).json({ reply: 'Invalid response from AI service. Raw: ' + text.slice(0, 200) });
    }

    if (!response.ok) {
      return res.status(500).json({ reply: 'API error ' + response.status + ': ' + (data.error ? data.error.message : text.slice(0, 200)) });
    }

    if (data.content && data.content[0] && data.content[0].text) {
      return res.status(200).json({ reply: data.content[0].text });
    }

    return res.status(500).json({ reply: 'Unexpected response format: ' + JSON.stringify(data).slice(0, 200) });

  } catch (error) {
    return res.status(500).json({ reply: 'Network error: ' + error.message });
  }
};
