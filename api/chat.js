import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user)
    return res.status(401).json({ error: "Unauthorized" });

  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: "No message" });

  // Load complete user profile
  let profile = {};
  let finData = {};
  let debts = [];
  let fears = [];
  let goals = [];

  try {
    const { data: p } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (p) profile = p;
  } catch (e) {}

  try {
    const { data: f } = await supabase
      .from("financial_data")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (f) finData = f;
  } catch (e) {}

  // Parse fears and goals from financial_challenge field
  if (profile.financial_challenge) {
    fears = profile.financial_challenge
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  // Load debts from chat history context or profile
  const cur = profile.currency || "USD";
  const name = profile.full_name
    ? profile.full_name.split(" ")[0]
    : user.email.split("@")[0];
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Build fear descriptions
  const fearMap = {
    debt: "never getting out of debt",
    paycheck: "living paycheck to paycheck forever",
    emergency: "one emergency destroying everything",
    family: "not being able to provide for family",
    future: "not having enough for the future",
    shame: "the shame of their financial situation",
    alone: "facing this alone with no guidance",
    job: "losing their job with no financial cushion",
  };

  const goalMap = {
    debt: "eliminate debt completely",
    save: "build real savings for the first time",
    house: "buy their own home",
    emergency: "build a solid emergency fund",
    business: "start their own business",
    freedom: "stop financial anxiety forever",
    family: "provide a better life for their family",
    travel: "travel and experience the world",
    retire: "retire comfortably one day",
    education: "pay for education",
  };

  const fearDescriptions = fears
    .map((f) => fearMap[f] || f)
    .filter(Boolean)
    .join(", ");

  const goalDescriptions = goals
    .map((g) => goalMap[g] || g)
    .filter(Boolean)
    .join(", ");

  // Build Mina's complete system prompt
  const systemPrompt = `You are Mina — a strict, caring, honest personal financial coach. Named after the founder's wife. You are not a chatbot. You are a real coach who tells the truth without judgment.

TODAY: ${today}
CLIENT: ${name}
CURRENCY: ${cur}

COMPLETE FINANCIAL PROFILE:
- Monthly income: ${cur} ${profile.monthly_income || 0}
- Monthly available: ${cur} ${finData.monthly_budget || 0}
- Total debt: ${cur} ${finData.total_debt || 0}
- Total savings: ${cur} ${finData.total_savings || 0}
- Emergency fund: ${cur} ${finData.emergency_fund || 0}
- Health score: ${finData.health_score || 0}/100
- Language preference: ${profile.language || "en"}
- Payday date: ${profile.payday_date || "not set"}
- Dependents: ${profile.dependents || 0}

BIGGEST FEARS (${name} told you these personally):
${fearDescriptions ? fearDescriptions : "Not specified yet"}

FINANCIAL GOALS (${name} wants to achieve these):
${goalDescriptions ? goalDescriptions : "Not specified yet"}

YOUR COACHING PHILOSOPHY:
1. You remember EVERYTHING ${name} told you. Reference their fears and goals naturally in your responses — not robotically.
2. You are honest — never sell dreams. Tell the truth with compassion.
3. You are specific — always use their real numbers (${cur}), never generic advice.
4. You are strict but caring — like a great fitness coach. Celebrate wins. Call out slipping.
5. You never say "I don't have access to your data" — you have everything above.
6. You speak in ${profile.language === "fr" ? "French" : profile.language === "ar" ? "Arabic" : profile.language === "es" ? "Spanish" : "English"} if that is their preference.
7. Keep responses focused and actionable — 3-5 sentences max unless they ask for detail.

FIRST MESSAGE RULES:
- If this is the first message, greet ${name} warmly, acknowledge their biggest fear directly, and connect it to what you will help them achieve.
- Example: "Welcome back ${name}. I remember you told me your biggest concern is ${fearDescriptions ? fears[0] : "your finances"}. That is exactly what we are going to work on together. Where would you like to start?"

IMPORTANT: Never be generic. Every response must reference their actual numbers or their stated fears/goals.`;

  try {
    // Save message to chat history
    try {
      await supabase.from("chat_history").insert({
        user_id: user.id,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      });
    } catch (e) {}

    // Build messages array
    const messages = [];
    if (history && history.length > 0) {
      history.slice(-12).forEach((m) => {
        if (m.role === "user" || m.role === "assistant") {
          messages.push({ role: m.role, content: m.content });
        }
      });
    }
    messages.push({ role: "user", content: message });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: systemPrompt,
      messages: messages,
    });

    const reply =
      response.content[0]?.text || "I am having trouble connecting. Try again.";

    // Save response to chat history
    try {
      await supabase.from("chat_history").insert({
        user_id: user.id,
        role: "assistant",
        content: reply,
        created_at: new Date().toISOString(),
      });
    } catch (e) {}

    return res.status(200).json({ response: reply });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Failed to get response from Mina" });
  }
}
