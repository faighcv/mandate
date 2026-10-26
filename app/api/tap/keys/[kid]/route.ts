import { NextResponse } from "next/server";
import { publicKey } from "@/lib/visa/tap";

/** Public key directory for agent TAP signatures (the role Visa's key endpoint plays in production). */
export async function GET(_req: Request, { params }: { params: Promise<{ kid: string }> }) {
  const { kid } = await params;
  const jwk = publicKey(kid);
  return jwk ? NextResponse.json(jwk) : NextResponse.json({ error: "unknown key" }, { status: 404 });
}
