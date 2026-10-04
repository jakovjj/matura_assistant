"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { createBilling, verifySignature } = require("../billing.js");
const now = Math.floor(Date.now() / 1000);
const secret = "whsec_unit_test";
function signature(body, time = now) {
  return `t=${time},v1=${crypto.createHmac("sha256", secret).update(`${time}.${body}`).digest("hex")}`;
}
function fixture() {
  const database = new DatabaseSync(":memory:");
  const user = { id: "user-1", email: "unit@example.invalid" };
  const state = { subs: [], invoiceEnd: now + 86400 * 30, invoicePaid: true, calls: [], checkout: null, badPrice: false, fail: false };
  async function fetchImpl(url, options) {
    const endpoint = url.replace("https://api.stripe.com/v1/", "");
    const params = Object.fromEntries(options.body || []);
    state.calls.push({ endpoint, params, headers: options.headers });
    if (state.fail) throw new Error("Test network failure");
    let data;
    if (endpoint === "prices/price_test") data = { active: true, livemode: false, currency: "eur", unit_amount: state.badPrice ? 1900 : 790, recurring: { interval: "month", interval_count: 1 }, tax_behavior: "inclusive" };
    else if (endpoint === "customers") data = { id: "cus_test" };
    else if (endpoint.startsWith("subscriptions?")) data = { data: state.subs };
    else if (endpoint.startsWith("invoices?")) data = { data: state.invoicePaid ? [{ status: "paid", currency: "eur", lines: { data: [{ price: { id: "price_test" }, period: { end: state.invoiceEnd } }] } }] : [] };
    else if (endpoint === "checkout/sessions") { state.checkout = { id: "cs_test", status: "open", url: "https://checkout.stripe.com/test" }; data = state.checkout; }
    else if (endpoint === "checkout/sessions/cs_test") data = state.checkout;
    else if (endpoint === "billing_portal/sessions") data = { url: "https://billing.stripe.com/test" };
    else throw new Error(`Unexpected API ${endpoint}`);
    return { ok: true, json: async () => data };
  }
  const options = { database, secretKey: "sk_test_unit", webhookSecret: secret, priceId: "price_test", baseUrl: "https://matura.example", getUser: id => id === user.id ? user : null, fetchImpl };
  const billing = createBilling(options);
  const sub = (overrides = {}) => ({ id: "sub_test", livemode: false, status: "active", customer: "cus_test", items: { data: [{ price: { id: "price_test" }, quantity: 1 }] }, current_period_end: state.invoiceEnd, ...overrides });
  async function event(id, type = "invoice.paid", extras = {}) {
    const body = JSON.stringify({ id, type, livemode: false, data: { object: { customer: "cus_test" } }, ...extras });
    return billing.webhook(body, signature(body));
  }
  return { database, user, state, billing, options, sub, event };
}

test("signature rejects missing, expired, malformed and tampered signatures; accepts rotation", () => {
  const body = '{"id":"evt"}';
  assert.equal(verifySignature(body, signature(body), secret), true);
  assert.equal(verifySignature(body, `${signature(body)},v1=${"0".repeat(64)}`, secret), true);
  assert.equal(verifySignature(body, signature(body, now - 600), secret), false);
  assert.equal(verifySignature(body + "x", signature(body), secret), false);
  assert.equal(verifySignature(body, "t=NaN,v1=00", secret), false);
  assert.equal(verifySignature(body, "", secret), false);
});
test("parallel checkout requests reuse one customer and session with server-owned price and identity", async () => {
  const f = fixture();
  const results = await Promise.all([f.billing.checkout(f.user), f.billing.checkout(f.user)]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(f.state.calls.filter(x => x.endpoint === "customers").length, 1);
  const creates = f.state.calls.filter(x => x.endpoint === "checkout/sessions");
  assert.equal(creates.length, 1);
  assert.equal(creates[0].params["line_items[0][price]"], "price_test");
  assert.equal(creates[0].params.client_reference_id, f.user.id);
  assert.equal(creates[0].params.mode, "subscription");
  assert.equal(f.billing.summary(f.user).active, false);
});
test("price validation fails before customer or checkout creation", async () => {
  const f = fixture(); f.state.badPrice = true;
  await assert.rejects(f.billing.checkout(f.user), /Cijena/);
  assert.equal(f.state.calls.length, 1);
});
test("paid activation, duplicate events, renewal and reordered payloads use current paid invoice", async () => {
  const f = fixture(); await f.billing.checkout(f.user);
  f.state.subs = [f.sub()]; await f.event("evt_1");
  const first = f.billing.summary(f.user).premiumUntil;
  assert.equal(first, new Date(f.state.invoiceEnd * 1000).toISOString());
  const count = f.state.calls.length;
  await f.event("evt_1"); assert.equal(f.state.calls.length, count);
  await f.event("evt_2", "checkout.session.completed"); assert.equal(f.billing.summary(f.user).premiumUntil, first);
  f.state.invoiceEnd += 86400 * 31;
  await f.event("evt_3");
  await f.event("evt_old", "customer.subscription.deleted"); // stale payload must not revoke current state
  assert.equal(f.billing.summary(f.user).premiumUntil, new Date(f.state.invoiceEnd * 1000).toISOString());
  assert.equal((await f.billing.checkout(f.user)).url, "https://billing.stripe.com/test");
  const restored = createBilling(f.options);
  assert.equal(restored.summary(f.user).premiumUntil, f.billing.summary(f.user).premiumUntil);
});
test("failed initial payment never grants access, failure after renewal does not extend it", async () => {
  const f = fixture(); await f.billing.checkout(f.user);
  f.state.invoicePaid = false; f.state.subs = [f.sub({ status: "incomplete" })];
  await f.event("evt_fail", "invoice.payment_failed");
  assert.equal(f.billing.summary(f.user).active, false);
  f.state.invoicePaid = true; f.state.invoiceEnd = now - 10; f.state.subs = [f.sub({ status: "past_due" })];
  await f.event("evt_fail2", "invoice.payment_failed");
  assert.equal(f.billing.summary(f.user).active, false);
  assert.equal(f.billing.summary(f.user).status, "past_due");
});
test("scheduled cancellation preserves paid access, immediate cancellation ends it", async () => {
  const f = fixture(); await f.billing.checkout(f.user);
  f.state.subs = [f.sub({ cancel_at_period_end: true })]; await f.event("evt_cancel", "customer.subscription.updated");
  assert.equal(f.billing.summary(f.user).active, true);
  assert.equal(f.billing.summary(f.user).cancelAtPeriodEnd, true);
  f.state.subs = [f.sub({ status: "canceled", ended_at: now - 1 })]; await f.event("evt_end", "customer.subscription.deleted");
  assert.equal(f.billing.summary(f.user).active, false);
});
test("wrong product and wrong environment cannot activate access", async () => {
  const f = fixture(); await f.billing.checkout(f.user);
  f.state.subs = [f.sub({ items: { data: [{ price: { id: "other" }, quantity: 1 }] } })];
  await f.event("evt_wrong"); assert.equal(f.billing.summary(f.user).active, false);
  f.state.subs = [f.sub()]; await f.event("evt_live", "invoice.paid", { livemode: true });
  assert.equal(f.billing.summary(f.user).active, false);
});
test("transient API failure is retryable and does not mark webhook processed", async () => {
  const f = fixture(); await f.billing.checkout(f.user); f.state.subs = [f.sub()];
  f.state.fail = true; await assert.rejects(f.event("evt_retry"));
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM billing_webhook_events").get().n, 0);
  f.state.fail = false; await f.event("evt_retry"); assert.equal(f.billing.summary(f.user).active, true);
});
test("annual legacy access survives and blocks an overlapping purchase", async () => {
  const f = fixture(); f.user.premiumUntil = new Date((now + 86400 * 100) * 1000).toISOString();
  await assert.rejects(f.billing.checkout(f.user), /Već imaš/);
  assert.equal(f.billing.summary(f.user).premiumUntil, f.user.premiumUntil);
});
test("subscription status survives closing and reopening the SQLite file", async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'matura-billing-db-'));
  const f = fixture(); await f.billing.checkout(f.user); f.state.subs = [f.sub()]; await f.event('evt_durable');
  const filename = path.join(directory, 'billing.sqlite');
  f.database.prepare('VACUUM INTO ?').run(filename);
  const db = new DatabaseSync(filename);
  try {
    const restored = createBilling({ ...f.options, database: db });
    assert.equal(restored.summary(f.user).premiumUntil, f.billing.summary(f.user).premiumUntil);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM billing_webhook_events').get().n, 1);
  } finally { db.close(); fs.rmSync(directory, { recursive: true }); }
});
