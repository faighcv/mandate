import { NextResponse } from "next/server";
import { handleMerchant } from "@/lib/visa/merchants";

/** Demo merchant storefront API: accepts agent traffic only with a valid Visa TAP signature. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; op: string }> }) {
  const { id, op } = await params;
  if (op !== "quote" && op !== "checkout") return NextResponse.json({ error: "unknown operation" }, { status: 404 });
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = handleMerchant(op, id, {
    authority: req.headers.get("host") ?? url.host,
    path: url.pathname,
    signatureInput: req.headers.get("signature-input"),
    signature: req.headers.get("signature"),
  }, body);
  return NextResponse.json(r.body, { status: r.status });
}
