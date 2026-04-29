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

  const { message, history, systemPrompt } = req.body;
  if (!message) return res.status(400).json({ error: "No message" });

  // Use system prompt from dashboard (contains complete localStorage data)
  // Fall back to building from Supabase only if no systemPrompt provided
  let finalSystemPrompt = systemPrompt;

  if (!finalSystemPrompt) {
    // Fallback - build from Supabase
    let profile = {}, finData = {};
    try {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (p) profile = p;
    } catch (e) {}
    try {
      const { data: f } = await supabase.from("financial_data").select("*").eq("user_id", user.id).single();
      if (f) finData = f;
    } catch (e) {}

    const cur = profile.currency || "USD";
    const name = profile.full_name ? profile.full_name.split(" ")[0] : "there";
    const today = new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

    finalSystemPrompt = `You are Mina — a strict, caring, honest personal financial coach for Sum Goals.

TODAY: ${today}
CLIENT: ${name}
CURRENCY: ${cur}

FINANCIAL PROFILE:
- Monthly income: ${cur} ${(profile.monthly_income || 0).toLocaleString()}
- Monthly available: ${cur} ${(finData.monthly_budget || 0).toLocaleString()}
- Total debt: ${cur} ${(finData.total_debt || 0).toLocaleString()}
- Savings: ${cur} ${(finData.total_savings || 0).toLocaleString()}
- Emergency fund: ${cur} ${(finData.emergency_fund || 0).toLocaleString()}
- Health score: ${finData.health_score || 0}/100
- Biggest concerns: ${profile.financial_challenge || "not specified"}

RULES:
1. NEVER say you do not have their data.
2. NEVER ask for income — you already know it.
3. Always use their real numbers. Never generic advice.
4. Be strict but caring. Tell the truth. Never sell dreams.
5. Keep responses under 200 words unless asked for more.
6. Always give 2-3 specific actionable steps with real numbers in ${cur}.`;
  }

  try {
    // Build messages array
    const messages = [];
    if (history && history.length > 0) {
      history.slice(-14).forEach((m) => {
        if (m.role === "user" || m.role === "assistant") {
          messages.push({ role: m.role, content: m.content });
        }
      });
    }
    messages.push({ role: "user", content: message });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: finalSystemPrompt,
      messages: messages,
    });

    const reply = response.content[0]?.text || "I am having trouble connecting. Try again.";

    // Save to chat history
    try {
      await supabase.from("chat_history").insert([
        { user_id: user.id, role: "user", content: message, created_at: new Date().toISOString() },
        { user_id: user.id, role: "assistant", content: reply, created_at: new Date().toISOString() }
      ]);
    } catch (e) {}

    return res.status(200).json({ response: reply });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Failed to get response from Mina" });
  }
}
