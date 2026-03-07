// api/create-checkout.js  —  Vercel Serverless Function
// Creates a Stripe Checkout session for Pro upgrades

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const origin = req.headers.origin || "https://decisionreset.vercel.app";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { userId, userEmail, plan } = req.body; // plan: "monthly" | "annual"

  if (!userId || !userEmail) {
    return res.status(400).json({ error: "userId and userEmail required" });
  }

  const priceId = plan === "annual"
    ? process.env.STRIPE_ANNUAL_PRICE_ID    // $59/year
    : process.env.STRIPE_MONTHLY_PRICE_ID;  // $9.99/month

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId, priceId },
      success_url: `${origin}?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?upgrade=cancelled`,
      subscription_data: {
        metadata: { userId },
        trial_period_days: 0,
      },
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return res.status(500).json({ error: error.message });
  }
}
