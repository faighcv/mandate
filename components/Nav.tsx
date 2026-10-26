"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Command centre", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { href: "/agents", label: "AI workforce", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21a8 8 0 0116 0" },
  { href: "/approvals", label: "Approvals", icon: "M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/inbox", label: "Inbox", icon: "M3 8l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" },
  { href: "/finance", label: "Money", icon: "M12 8c-2.2 0-4 .9-4 2s1.8 2 4 2 4 .9 4 2-1.8 2-4 2m0-8V6m0 10v2M4 4h16v16H4z" },
  { href: "/brain", label: "Company Brain", icon: "M12 6v12M6 12h12M4 4h16v16H4z" },
  { href: "/audit", label: "Audit log", icon: "M9 5h6M9 9h6M9 13h4M5 3h14v18H5z" },
  { href: "/settings", label: "Settings & red team", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" },
];

export function Nav({ approvals }: { approvals: number }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={i.icon} /></svg>
            <span className="flex-1">{i.label}</span>
            {i.href === "/approvals" && approvals > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-slate-900">{approvals}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
