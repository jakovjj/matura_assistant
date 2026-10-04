"use strict";
const crypto = require("node:crypto");
const VERSION = "2025-02-24.acacia";
const idOf = (value) => typeof value === "string" ? value : value?.id;
const relevantEvents = new Set([
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed", "checkout.session.expired",
  "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
]);

function verifySignature(body, header, secret, now = Date.now()) {
  const parts = String(header || "").split(",").map(part => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  if (!/^\d+$/.test(timestamp || "") || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return parts.some(([key, value]) => key === "v1" && /^[a-f0-9]{64}$/i.test(value || "") &&
    crypto.timingSafeEqual(expected, Buffer.from(value, "hex")));
}

function createBilling({ database, secretKey, webhookSecret, priceId, baseUrl, getUser, fetchImpl = fetch }) {
  database.exec(`CREATE TABLE IF NOT EXISTS billing_accounts (
    user_id TEXT PRIMARY KEY, customer_id TEXT UNIQUE, state_json TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS billing_webhook_events (
    id TEXT PRIMARY KEY, processed_at TEXT NOT NULL
  );`);
  let queue = Promise.resolve();
  const serial = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const configured = Boolean(secretKey && webhookSecret && priceId && /^https:\/\//.test(baseUrl));
  const live = secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
  const load = (userId) => {
    const row = database.prepare("SELECT state_json FROM billing_accounts WHERE user_id = ?").get(userId);
    return row ? JSON.parse(row.state_json) : { userId, subscriptions: [] };
  };
  const save = (state) => database.prepare(`INSERT INTO billing_accounts VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET customer_id=excluded.customer_id, state_json=excluded.state_json`)
    .run(state.userId, state.customerId || null, JSON.stringify(state));

  async function api(endpoint, params, idempotencyKey) {
    const headers = { Authorization: `Bearer ${secretKey}`, "Stripe-Version": VERSION };
    if (params) headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await fetchImpl(`https://api.stripe.com/v1/${endpoint}`, {
      method: params ? "POST" : "GET", headers,
      body: params ? new URLSearchParams(params) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error("Stripe trenutačno nije dostupan. Pokušaj ponovno.");
      error.stripeCode = data.error?.code;
      throw error;
    }
    return data;
  }
  let verifiedPriceUntil = 0;
  async function verifyPrice() {
    if (verifiedPriceUntil > Date.now()) return;
    const price = await api(`prices/${encodeURIComponent(priceId)}`);
    if (!price.active || price.livemode !== live || price.currency !== "eur" || price.unit_amount !== 790 ||
      price.recurring?.interval !== "month" || price.recurring?.interval_count !== 1 || price.tax_behavior !== "inclusive") {
      throw new Error("Cijena pretplate nije ispravno konfigurirana.");
    }
    verifiedPriceUntil = Date.now() + 300000;
  }
  const selectedItem = (sub) => sub.items?.data?.find(item => idOf(item.price) === priceId && item.quantity === 1);

  // Always reconcile current Stripe state, never add days from an event payload.
  // This also makes delayed and reordered deliveries safe.
  async function reconcile(state) {
    if (!state.customerId) return state;
    const result = await api(`subscriptions?customer=${encodeURIComponent(state.customerId)}&status=all&limit=100`);
    if (result.has_more) throw new Error("Potrebna je provjera pretplata računa.");
    const subscriptions = [];
    for (const sub of result.data) {
      if (!selectedItem(sub) || sub.livemode !== live) continue;
      const invoices = await api(`invoices?subscription=${encodeURIComponent(sub.id)}&status=paid&limit=1`);
      const invoice = invoices.data[0];
      let paidUntil = 0;
      if (invoice?.status === "paid" && invoice.currency === "eur") {
        const lines = invoice.lines?.data || [];
        // API version is pinned, but tolerate newer invoice line shapes as well.
        for (const line of lines) {
          const linePrice = idOf(line.price) || line.pricing?.price_details?.price;
          if (linePrice === priceId && !line.proration && !line.parent?.subscription_item_details?.proration) {
            paidUntil = Math.max(paidUntil, Number(line.period?.end) || 0);
          }
        }
      }
      if (["incomplete", "incomplete_expired", "paused", "unpaid"].includes(sub.status)) paidUntil = 0;
      if (sub.status === "canceled") paidUntil = Math.min(paidUntil, Number(sub.ended_at) || 0);
      subscriptions.push({ id: sub.id, status: sub.status, paidUntil,
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
        periodEnd: selectedItem(sub).current_period_end || sub.current_period_end || paidUntil });
    }
    state.subscriptions = subscriptions;
    state.syncedAt = Date.now();
    save(state);
    return state;
  }
  function summary(user, state = load(user.id)) {
    const legacyUntil = Date.parse(user.premiumUntil || "") || 0;
    const paidUntil = Math.max(legacyUntil, ...state.subscriptions.map(sub => sub.paidUntil * 1000), 0);
    const ongoing = state.subscriptions.find(sub => !["canceled", "incomplete_expired"].includes(sub.status));
    return { configured, active: paidUntil > Date.now(), premiumUntil: paidUntil ? new Date(paidUntil).toISOString() : null,
      hasCustomer: Boolean(state.customerId), status: ongoing?.status || (paidUntil > Date.now() ? "active" : "none"),
      cancelAtPeriodEnd: Boolean(ongoing?.cancelAtPeriodEnd),
      periodEnd: ongoing?.periodEnd ? new Date(ongoing.periodEnd * 1000).toISOString() : null };
  }
  async function portal(state) {
    if (!state.customerId) throw new Error("Nema pretplate za upravljanje.");
    return api("billing_portal/sessions", { customer: state.customerId, return_url: `${baseUrl}/profil` });
  }
  async function checkout(user) {
    await verifyPrice();
    let state = await reconcile(load(user.id));
    const existing = state.subscriptions.find(sub => !["canceled", "incomplete_expired"].includes(sub.status));
    if (existing) return portal(state);
    if (summary(user, state).active) throw new Error("Već imaš plaćeni pristup. Nova kupnja bit će dostupna nakon isteka.");
    if (!state.customerId) {
      const customer = await api("customers", { email: user.email, "metadata[matura_user_id]": user.id }, `matura-customer-${user.id}`);
      state.customerId = customer.id;
      save(state);
    }
    if (state.checkoutId) {
      const session = await api(`checkout/sessions/${encodeURIComponent(state.checkoutId)}`);
      if (session.status === "open" && session.url) return session;
      if (session.status === "complete") {
        state = await reconcile(state);
        if (state.subscriptions.some(sub => !["canceled", "incomplete_expired"].includes(sub.status))) return portal(state);
      }
      state.checkoutId = null;
      state.attempt = null;
      save(state);
    }
    if (!state.attempt) { state.attempt = crypto.randomUUID(); save(state); }
    const session = await api("checkout/sessions", {
      mode: "subscription", customer: state.customerId, client_reference_id: user.id,
      "metadata[matura_user_id]": user.id, "subscription_data[metadata][matura_user_id]": user.id,
      "line_items[0][price]": priceId, "line_items[0][quantity]": "1",
      "payment_method_types[0]": "card", locale: "hr",
      success_url: `${baseUrl}/plus?success=1`, cancel_url: `${baseUrl}/plus?canceled=1`,
    }, `matura-checkout-${state.attempt}`);
    state.checkoutId = session.id;
    save(state);
    return session;
  }
  async function processEvent(event) {
    if (!relevantEvents.has(event.type) || event.livemode !== live) return;
    if (database.prepare("SELECT id FROM billing_webhook_events WHERE id=?").get(event.id)) return;
    const customerId = idOf(event.data?.object?.customer);
    const row = customerId && database.prepare("SELECT user_id FROM billing_accounts WHERE customer_id=?").get(customerId);
    if (row && getUser(row.user_id)) await reconcile(load(row.user_id));
    database.prepare("INSERT INTO billing_webhook_events VALUES (?, ?)").run(event.id, new Date().toISOString());
  }
  return {
    configured, summary,
    status: (user) => serial(async () => {
      let state = load(user.id);
      if (configured && state.customerId && Date.now() - (state.syncedAt || 0) > 5000) state = await reconcile(state);
      return summary(user, state);
    }),
    checkout: (user) => serial(() => checkout(user)),
    portal: (user) => serial(() => portal(load(user.id))),
    async webhook(body, signature) {
      if (!webhookSecret || !verifySignature(body, signature, webhookSecret)) {
        const error = new Error("Neispravan potpis."); error.status = 400; throw error;
      }
      let event;
      try { event = JSON.parse(body); } catch { const error = new Error("Neispravan JSON."); error.status = 400; throw error; }
      if (typeof event.id !== "string" || typeof event.type !== "string") {
        const error = new Error("Neispravan događaj."); error.status = 400; throw error;
      }
      return serial(() => processEvent(event));
    },
  };
}
module.exports = { createBilling, verifySignature };
