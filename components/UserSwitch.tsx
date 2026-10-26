"use client";

import { useTransition } from "react";
import { setCurrentUser } from "@/app/actions";

const PEOPLE = ["Priya (Finance Lead)", "Jordan (Operations)", "Sam (AR Clerk)"];

export function UserSwitch({ current }: { current: string }) {
  const [, start] = useTransition();
  return (
    <select
      value={current}
      onChange={(e) => start(() => setCurrentUser(e.target.value))}
      className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 outline-none"
    >
      {PEOPLE.map((p) => (
        <option key={p} value={p} className="text-ink">{p}</option>
      ))}
    </select>
  );
}
