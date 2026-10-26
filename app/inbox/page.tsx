import Link from "next/link";
import { all, get } from "@/lib/db";
import { counterpartyName, type Conversation, type Message } from "@/lib/channels";
import { ensureWorkspace, ago } from "@/lib/view";
import { AutoRefresh } from "@/components/client";
import { ReplyBox } from "@/components/ops/ReplyBox";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const ChannelBadge = ({ channel }: { channel: string }) => <Badge tone={channel === "whatsapp" ? "green" : "blue"}>{channel === "whatsapp" ? "WhatsApp" : "Email"}</Badge>;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  ensureWorkspace();
  const { c } = await searchParams;
  const convs = all<Conversation>("SELECT * FROM conversations ORDER BY updated_at DESC");
  const selected = convs.find((x) => x.id === c) ?? convs[0];
  const thread = selected ? all<Message>("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at", selected.id) : [];
  const agentNames = new Map(all<{ id: string; name: string }>("SELECT id, name FROM agents").map((a) => [a.id, a.name]));
  const name = selected ? counterpartyName(selected.counterparty_type, selected.counterparty_id) : "";
  return (
    <>
      <AutoRefresh ms={3000} />
      <PageHeader title="Inbox" subtitle="Every email and WhatsApp conversation agents have with customers and suppliers. Delivery is simulated in-app; the policy engine decides who each agent may contact and on which channel." />
      {convs.length === 0 ? (
        <Empty>No conversations yet. Run the Collections agent from the command centre to send the first reminders.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card pad={false} className="h-fit">
            <ul className="divide-y divide-line">
              {convs.map((cv) => {
                const last = get<{ body: string; direction: string; created_at: string }>("SELECT body, direction, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1", cv.id);
                const active = cv.id === selected?.id;
                return (
                  <li key={cv.id}>
                    <Link href={`/inbox?c=${cv.id}`} className={`block px-4 py-3 ${active ? "bg-brand-soft" : "hover:bg-slate-50"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{counterpartyName(cv.counterparty_type, cv.counterparty_id)}</span>
                        <ChannelBadge channel={cv.channel} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate">{last ? `${last.direction === "in" ? "" : "You: "}${last.body}` : "No messages"}</span>
                        <span className="shrink-0">{ago(cv.updated_at)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
          {selected && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  {name} <Badge>{selected.counterparty_type}</Badge> <ChannelBadge channel={selected.channel} />
                </span>
              }
            >
              <div className="space-y-3">
                {thread.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.direction === "out" ? "rounded-br-sm bg-brand text-white" : "rounded-bl-sm border border-line bg-slate-50"}`}>
                      <div className={`mb-1 flex items-center gap-2 text-[11px] ${m.direction === "out" ? "text-indigo-100" : "text-muted"}`}>
                        <span className="font-medium">{m.direction === "out" ? (m.agent_id ? agentNames.get(m.agent_id) ?? m.sender : m.sender) : m.sender}</span>
                        <span>{ago(m.created_at)}</span>
                        {m.run_id && (
                          <Link href={`/runs/${m.run_id}`} className="underline underline-offset-2">
                            run
                          </Link>
                        )}
                      </div>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 border-t border-line pt-4">
                <ReplyBox conversationId={selected.id} name={name} channel={selected.channel} />
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
