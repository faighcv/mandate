import { ensureWorkspace } from "@/lib/view";
import { providerName } from "@/lib/llm";
import { PageHeader } from "@/components/ui";
import { AgentEditor } from "@/components/AgentEditor";
import { editorProps } from "../editor-props";

export const dynamic = "force-dynamic";

const EXAMPLES = [
  "Every morning, check overdue invoices, follow up by email or WhatsApp, offer extensions within our policy, and alert me about exceptions.",
  "When someone on the team asks for supplies, get quotes from our approved merchants and buy the best option up to $500, ask me before buying anything more expensive.",
  "Every day, forecast our cash for the next six weeks, buy EUR or CAD just before supplier bills are due, and pay verified suppliers on time. Alert me if cash drops below our buffer.",
  "Whenever a payment arrives, reconcile it against open invoices using the reference, amount and payer, and flag anything you can't match.",
];

export default function NewAgentPage() {
  ensureWorkspace();
  const llm = providerName();
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Create an AI coworker"
        subtitle={<>Describe the job in plain English. Mandate drafts the triggers, tools, data access, contacts and money limits with least privilege, and you approve each one. {llm === "sim" ? "No model key is set, so the rule-based drafter is used." : `Drafted by ${llm}, then clamped to least privilege.`}</>}
      />
      <AgentEditor mode="create" examples={EXAMPLES} {...editorProps()} />
    </div>
  );
}
