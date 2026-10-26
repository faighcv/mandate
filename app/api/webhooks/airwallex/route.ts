import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/airwallex/live";
import { audit } from "@/lib/audit";
import { get, insert } from "@/lib/db";
import { emit } from "@/lib/events";
import { failTransfer, recordLinkPayment } from "@/lib/finance";
import { update } from "@/lib/db";
import { id, nowIso } from "@/lib/util";

export const dynamic = "force-dynamic";

/**
 * Airwallex webhooks. The signature (HMAC-SHA256 of x-timestamp + raw body) is verified before the
 * body is parsed; events then update the ledger and wake the agents subscribed to them.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.AIRWALLEX_WEBHOOK_SECRET;
  if (!secret || !verifyWebhook(raw, req.headers.get("x-timestamp"), req.headers.get("x-signature"), secret)) {
    audit({ actor: "airwallex", action: "webhook.rejected", decision: "deny", details: { reason: secret ? "bad signature" : "no secret configured" } });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const evt = JSON.parse(raw) as { id: string; name: string; data?: { object?: Record<string, unknown> } };
  const obj = evt.data?.object ?? {};
  insert("events", { id: id("evt"), type: `airwallex.${evt.name}`, payload: { airwallex_event_id: evt.id, object: obj }, source: "airwallex-webhook", created_at: nowIso() });

  if (evt.name === "payment_link.paid") {
    const linkId = (obj.metadata as Record<string, string> | undefined)?.mandate_link_id ?? (obj.reference as string | undefined) ?? (obj.id as string);
    try {
      recordLinkPayment(linkId, { externalId: obj.latest_successful_payment_intent_id as string | undefined });
    } catch (e) {
      audit({ actor: "airwallex", action: "webhook.unmatched", details: { event: evt.name, linkId, error: String(e) } });
    }
  } else if (evt.name.startsWith("payout.transfer.")) {
    const t = get<{ id: string; bill_id: string | null; status: string }>("SELECT id, bill_id, status FROM transfers WHERE request_id = ? OR external_id = ?", String(obj.request_id ?? ""), String(obj.id ?? ""));
    const status = String(obj.status ?? evt.name.split(".").pop()).toUpperCase();
    if (t && t.status !== status) {
      if (status === "FAILED") failTransfer(t.id, String((obj.failure as { message?: string } | undefined)?.message ?? "Failed at the beneficiary bank"));
      else {
        update("transfers", t.id, { status, updated_at: nowIso() });
        if (status === "PAID" && t.bill_id) {
          update("bills", t.bill_id, { status: "paid" });
          emit("transfer.paid", { transfer_id: t.id, bill_id: t.bill_id }, "airwallex");
        }
      }
    }
  }
  return NextResponse.json({ received: true });
}
