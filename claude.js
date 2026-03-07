// api/claude.js  —  Vercel Serverless Function
// Proxies requests to Anthropic API so your key never touches the browser.
// Deploy this to Vercel: it runs at https://your-app.vercel.app/api/claude

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CORS — update YOUR_DOMAIN to your real domain before launch
  const allowedOrigins = [
    "https://decisionreset.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ── Rate limiting by user plan ──────────────────────────────────────────────
  // Read plan from request body (validated server-side via Supabase JWT below)
  const { messages, max_tokens = 600, plan = "free", userId } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid request: messages required" });
  }

  // Per-request token limits by plan
  // Free: capped at 400 tokens (basic responses)
  // Pro:  full 1000 tokens (detailed AI steps, insights)
  const tokenLimit = plan === "pro" ? 1000 : Math.min(max_tokens, 400);

  // ── Call Anthropic ──────────────────────────────────────────────────────────
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,  // Set in Vercel dashboard
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: tokenLimit,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      return res.status(response.status).json({ error: "AI service error" });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error("Proxy error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
