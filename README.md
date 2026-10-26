# Mandate

**The governed AI workforce for financial operations.** Your business has software for everything. Mandate gives you AI employees that actually get the work done, inside limits you set and a policy engine enforces.

Built for the Agentic Banking Hackathon.

## What it does

Employees describe a job in plain English and get an AI coworker with an enforceable **mandate**: which tools it may use, which data it can see, who it may contact and on which channel, which currencies it may move, how much per transaction and per day, what needs a person's approval, and whether it may delegate. Agents then watch business events, talk to customers and suppliers, and move money through Airwallex. Every tool call passes a server-side policy engine first, and every decision lands in a tamper-evident audit log.

| Agent | What it does in the demo |
|---|---|
| Collections | Finds overdue invoices, sends reminders with Airwallex payment links, negotiates installment plans within policy, escalates the rest |
| Reconciliation | Matches incoming payments (links and bank transfers) to invoices |
| Treasury | Six-week cash forecast, just-in-time FX conversion, pays supplier bills due soon |
| Payment Incidents | Investigates failed payouts, informs the supplier, never pays twice, treats bank-detail changes as fraud signals |
| Procurement | Gets quotes from approved merchants and buys with its own capped card, signing every merchant request with Visa Trusted Agent Protocol |
| Disputes | Gathers contract evidence and contests a chargeback only when it pays |
| Customer Relations | Answers billing questions (template, add it in the builder) |

## The guardrails, concretely

Enforced in code (`lib/policy/engine.ts`), not in the prompt. The model never holds credentials.

1. **Tool permission.** Tools absent from the mandate are refused. `update_mandate` exists only so the gateway can show that no agent may hold it: agents cannot change their own permissions.
2. **Data scopes.** Company Brain search is filtered by the agent's categories before ranking. Payroll and HR are excluded unless a person grants them.
3. **Contacts.** Channel (email, WhatsApp), counterparty type (customer, supplier, internal) and a known-recipient check.
4. **Money.** Allowed currencies, verified beneficiaries only, per-transaction and daily limits in USD equivalent, an auto-approve threshold, and **duplicate protection** (same idempotency key within 24 hours is refused, including payments still waiting for approval).
5. **Business state and company policy.** Invoice still open, link not already active, plan within the installment policy, bill not already in flight, quote not expired, merchant approved.
6. **Approval mode.** Any tool can be granted "needs approval". Approvals are re-checked against policy and live state at execution time, then executed with the approver recorded.
7. **Delegation.** A delegated task runs under the overlap of both mandates and cannot delegate further.
8. **Run budgets.** Maximum tool calls and tokens per run.
9. **Audit.** Every evaluation, approval and setting change is appended to a SHA-256 hash chain. `Verify chain` on the Audit page detects any edited or deleted row.

The Settings page has a **red-team console** that injects tool calls straight into the gateway, as a compromised agent would: reading payroll, paying a supplier from the collections agent, raising its own limit, paying an unverified supplier, emailing a stranger. All are blocked and logged.

## Architecture

```
Business events ──► Event bus ──► Agent runtime ──► LLM (Claude / OpenAI / offline simulator)
(overdue, reply,      (lib/events)   (lib/runtime)        │ tool calls
 payment, payout,                         │               ▼
 dispute, purchase)                       └──► Action gateway ──► Policy engine (mandate + company policy)
                                                  │  allow          │ approval            │ deny
                                                  ▼                 ▼                     ▼
                                          Tools ──► Airwallex   Approvals inbox ──►   refused + logged
                                          (money, messages,     re-check, execute,
                                           brain, Visa TAP)     resume the agent
                                                  │
                                                  ▼
                                      Hash-chained audit log (SQLite)
```

- **Next.js 16** app (App Router, server actions), **SQLite** via `node:sqlite`, TypeScript, Tailwind.
- **LLM layer** (`lib/llm`): provider-neutral transcript. Claude (`claude-opus-5-5`, adaptive thinking, server-side refusal fallbacks, prompt caching) or OpenAI (chat completions with tools). With no key it uses a scripted simulator that drives the same tools through the same gateway, so the whole product runs offline and the tests are deterministic.
- **Airwallex** (`lib/airwallex`): one `PaymentsRail` interface. `live.ts` calls the sandbox (`api.sandbox.airwallex.com`): login token caching, balances, payment links, transfers with `request_id` lookup before retry, FX rates and conversions, Issuing cards, transfer simulation, webhook HMAC verification. `sim.ts` is a local ledger that mirrors Airwallex objects and states when no keys are set.
- **Visa TAP** (`lib/visa`): each agent gets an Ed25519 key. Merchant requests carry RFC 9421 `Signature-Input` / `Signature` headers over `@authority` and `@path` with `tag` `agent-browser-auth` (quotes) or `agent-payer-auth` (checkout), 8-minute validity and a nonce. The demo merchants verify against the public key directory at `/api/tap/keys/{kid}` and reject replays.
- **Company Brain** (`lib/brain.ts`): contracts, policies, playbooks and past resolutions, searched only within the agent's data scopes.
- **Learning loop** (`lib/playbooks.ts`): agents propose playbook changes from verified outcomes; each proposal is tested against company policy and published only after a person approves.

## Run it

Requires Node 22.13 or later (Node 24 recommended).

```bash
npm install
cp .env.example .env      # optional: add ANTHROPIC_API_KEY or OPENAI_API_KEY, Airwallex sandbox keys
npm run dev               # http://localhost:3000
npm test                  # policy engine + end-to-end agent flows
```

With no keys at all, Mandate runs on the offline simulator and the simulated Airwallex ledger. The sidebar shows which model and money rail are active.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude (default `claude-opus-5-5`) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI alternative |
| `LLM_PROVIDER` | Force `anthropic`, `openai` or `sim` |
| `AIRWALLEX_CLIENT_ID` / `AIRWALLEX_API_KEY` | Airwallex sandbox (Developer > API keys) |
| `AIRWALLEX_BASE_URL` | Defaults to `https://api.sandbox.airwallex.com` |
| `AIRWALLEX_WEBHOOK_SECRET` | Secret for `/api/webhooks/airwallex` |
| `AIRWALLEX_CARDHOLDER_ID` | Optional: issue real sandbox cards for the procurement agent |
| `APP_URL` | Public URL (payment-link checkout pages, TAP merchant calls) |

**Hosting.** Agents run as background work inside the Node server, so deploy to a long-running Node host (Docker, Railway, Render, Fly). Serverless platforms stop work after the response and would cut agent runs short. A `Dockerfile` is included.

## Demo script

See [DEMO.md](DEMO.md) for a three-minute walkthrough. The command centre has the same steps as buttons.

## Project layout

```
app/                 pages, server actions, API routes (webhooks, TAP keys, merchants, tick)
components/          UI kit and client components
lib/policy/          mandate schema, policy engine, company policy
lib/runtime.ts       agent loop, action gateway, approvals, delegation, red-team harness
lib/tools/           every tool an agent can be granted
lib/airwallex/       live sandbox client and simulated ledger
lib/visa/            TAP signing and verification, demo merchants
lib/llm/             Claude, OpenAI and the offline simulator
lib/builder.ts       plain English to a least-privilege mandate
tests/               policy unit tests and end-to-end agent flows
```

## Honest status

- Verified by the test suite: every policy check, approvals with re-check, delegation narrowing, audit tamper detection, and eight end-to-end flows on the simulated rail with the scripted model.
- The Airwallex sandbox client follows the public API reference but has not been exercised against a live sandbox account in this repo. Transfers need suppliers linked to real sandbox beneficiary ids.
- Visa TAP signing follows RFC 9421 as described in Visa's TAP specification; Visa's own samples disagree on some serialisation details, so both sides here use strict RFC 9421. Visa Intelligent Commerce needs Visa onboarding and is not integrated.
- Email and WhatsApp delivery are simulated in the Inbox; the delivery function is the single place to plug in a provider.
- Hours-saved figures on the dashboard are estimates from per-action minute weights, not measurements.
