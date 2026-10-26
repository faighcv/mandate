import { NextResponse } from "next/server";
import { tick } from "@/lib/scheduler";
import { ensureWorkspace } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function POST() {
  ensureWorkspace();
  return NextResponse.json(await tick());
}
