import { NextResponse } from "next/server";
import { listPublicKeys } from "@/lib/visa/tap";

export async function GET() {
  return NextResponse.json({ keys: listPublicKeys() });
}
