// api/stripe-webhook.js  —  Vercel Serverless Function
// Handles Stripe payment events and updates Supabase user plan

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // Service role bypasses RLS for admin ops
);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const session = event.data.object;

  switch (event.type) {

    // ── Payment succeeded → upgrade user to Pro ──────────────────────────────
    case "checkout.session.completed": {
      const userId = session.metadata?.userId;
      const priceId = session.metadata?.priceId;
      if (!userId) break;

      const isAnnual = priceId === process.env.STRIPE_ANNUAL_PRICE_ID;
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + (isAnnual ? 12 : 1));

      await supabase.from("profiles").update({
        plan: "pro",
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        pro_expires_at: expiresAt.toISOString(),
        resets_used: 0,
      }).eq("id", userId);

      console.log(`✓ Upgraded user ${userId} to Pro (${isAnnual ? "annual" : "monthly"})`);
      break;
    }

    // ── Subscription renewed ─────────────────────────────────────────────────
    case "invoice.payment_succeeded": {
      const customerId = session.customer;
      const subId = session.subscription;
      if (!customerId) break;

      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      await supabase.from("profiles").update({
        plan: "pro",
        pro_expires_at: expiresAt.toISOString(),
        resets_used: 0,
      }).eq("stripe_customer_id", customerId);

      console.log(`✓ Renewed subscription for customer ${customerId}`);
      break;
    }

    // ── Subscription cancelled or payment failed → downgrade ─────────────────
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const customerId = session.customer;
      if (!customerId) break;

      await supabase.from("profiles").update({
        plan: "free",
        pro_expires_at: null,
        resets_limit: 3,
      }).eq("stripe_customer_id", customerId);

      console.log(`✓ Downgraded customer ${customerId} to Free`);
      break;
    }
  }

  return res.status(200).json({ received: true });
}
