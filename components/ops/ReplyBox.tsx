"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/client";
import { btnPrimary, input } from "@/components/ui";
import { replyAsCounterparty } from "@/app/actions";

export function ReplyBox({ conversationId, name, channel }: { conversationId: string; name: string; channel: string }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        start(async () => {
          await replyAsCounterparty(conversationId, body);
          setBody("");
          router.refresh();
        });
      }}
    >
      <div className="text-xs text-muted">
        Reply as <span className="font-medium text-ink">{name}</span>. Demo stand-in for their real {channel === "whatsapp" ? "WhatsApp" : "email"}: the message arrives as an inbound event and wakes the agent that owns this thread.
      </div>
      <textarea className={`${input} min-h-20`} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Write as ${name}...`} />
      <button className={btnPrimary} disabled={pending || !body.trim()}>
        {pending && <Spinner />} Send as {name}
      </button>
    </form>
  );
}
