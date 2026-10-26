import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Heartbeat } from "@/components/client";
import { UserSwitch } from "@/components/UserSwitch";
import { currentUser } from "./actions";
import { ensureWorkspace } from "@/lib/view";
import { get, getSetting } from "@/lib/db";
import { providerName } from "@/lib/llm";
import { railMode } from "@/lib/airwallex/rail";
import { isoDate, now } from "@/lib/util";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mandate: governed AI workforce for finance operations",
  description: "AI employees that act on money within enforceable mandates.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  ensureWorkspace();
  const approvals = get<{ n: number }>("SELECT COUNT(*) n FROM approvals WHERE status = 'pending'")!.n;
  const company = getSetting<{ name: string }>("company", { name: "" }).name;
  const offset = getSetting<number>("clock_offset_days", 0);
  const llm = providerName();
  const rail = railMode();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen font-sans">
        <Heartbeat />
        <div className="flex min-h-screen">
          <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-6 bg-slate-950 px-3 py-5 text-slate-200 max-md:hidden">
            <Link href="/" className="flex items-center gap-2 px-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">M</span>
              <span>
                <span className="block text-sm font-semibold text-white">Mandate</span>
                <span className="block text-[11px] text-slate-400">{company}</span>
              </span>
            </Link>
            <Nav approvals={approvals} />
            <div className="mt-auto space-y-3 px-2 text-[11px] text-slate-400">
              <div>
                <div className="mb-1 uppercase tracking-wide">Signed in as</div>
                <UserSwitch current={await currentUser()} />
              </div>
              <div className="space-y-1">
                <div>Model: <span className="text-slate-200">{llm === "sim" ? "offline simulator" : llm}</span></div>
                <div>Money rail: <span className="text-slate-200">{rail === "simulated" ? "simulated Airwallex" : "Airwallex sandbox"}</span></div>
                <div>Demo date: <span className="text-slate-200">{isoDate(now())}{offset ? ` (+${offset}d)` : ""}</span></div>
              </div>
            </div>
          </aside>
          <main className="min-w-0 flex-1">
            <div className="md:hidden flex items-center justify-between border-b border-line bg-slate-950 px-4 py-3 text-white">
              <Link href="/" className="font-semibold">Mandate</Link>
              <div className="flex gap-3 text-xs">
                <Link href="/agents">Agents</Link>
                <Link href="/approvals">Approvals{approvals ? ` (${approvals})` : ""}</Link>
                <Link href="/audit">Audit</Link>
              </div>
            </div>
            <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
