import { getSetting } from "@/lib/db";
import { providerName } from "@/lib/llm";
import { railMode } from "@/lib/airwallex/rail";
import { companyPolicy } from "@/lib/policy/company";
import { RED_TEAM_PROBES } from "@/lib/redteam";
import { listPublicKeys } from "@/lib/visa/tap";
import { appUrl } from "@/lib/util";
import { ensureWorkspace } from "@/lib/view";
import { getAgent } from "@/lib/runtime";
import { Badge, Card, PageHeader } from "@/components/ui";
import { DemoControls, FlagToggle, PolicyEditor, RedTeamProbe } from "@/components/ops/SettingsControls";

export const dynamic = "force-dynamic";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span className="text-muted">{k}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export default function SettingsPage() {
  ensureWorkspace();
  const llm = providerName();
  const model = llm === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-opus-5-5" : llm === "openai" ? process.env.OPENAI_MODEL || "gpt-5" : "scripted simulator";
  const rail = railMode();
  const keys = listPublicKeys();
  return (
    <>
      <PageHeader title="Settings and red team" subtitle="Integrations, company-wide policy that every agent is held to, and a console for attacking the guardrails yourself." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card title="Integrations">
            <div className="divide-y divide-line">
              <Row k="Model provider">
                <Badge tone={llm === "sim" ? "gray" : "green"}>{llm === "sim" ? "Offline simulator" : llm === "anthropic" ? "Anthropic Claude" : "OpenAI"}</Badge> <span className="font-mono text-xs">{model}</span>
              </Row>
              <Row k="Money rail">
                <Badge tone={rail === "simulated" ? "gray" : "green"}>{rail === "simulated" ? "Simulated Airwallex ledger" : "Airwallex sandbox"}</Badge>
              </Row>
              <Row k="Airwallex API">
                <span className="font-mono text-xs">{rail === "simulated" ? "not configured" : process.env.AIRWALLEX_BASE_URL || "https://api.sandbox.airwallex.com"}</span>
              </Row>
              <Row k="Webhook URL">
                <span className="font-mono text-xs">{appUrl()}/api/webhooks/airwallex</span>{" "}
                <Badge tone={process.env.AIRWALLEX_WEBHOOK_SECRET ? "green" : "amber"}>{process.env.AIRWALLEX_WEBHOOK_SECRET ? "secret set" : "no secret"}</Badge>
              </Row>
              <Row k="Visa TAP key directory">
                <a href="/api/tap/keys" className="font-mono text-xs text-brand hover:underline">/api/tap/keys</a> <Badge>{keys.length} agent key{keys.length === 1 ? "" : "s"}</Badge>
              </Row>
            </div>
            <p className="mt-3 text-xs text-muted">Set keys in <span className="font-mono">.env</span> (see <span className="font-mono">.env.example</span>). Without them everything still runs end to end on the simulator and the local ledger.</p>
          </Card>
          <Card title="Automation">
            <div className="space-y-4">
              <FlagToggle flag="autopilot" value={getSetting("autopilot", false)} title="Autopilot" hint="Run scheduled agents automatically when their period comes round (every page keeps a heartbeat going)." />
              <FlagToggle flag="auto_replies" value={getSetting("auto_replies", true)} title="Simulated customer replies" hint="Scripted customers answer the first reminder they receive, so negotiations start on their own." />
            </div>
          </Card>
          <Card title="Company policy (enforced in code)">
            <p className="mb-3 text-xs text-muted">These numbers apply to every agent on top of its own mandate. Plans or extensions outside them are escalated for approval, whatever an agent or a document says.</p>
            <PolicyEditor policy={companyPolicy()} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Red-team console">
            <p className="text-xs text-muted">Each probe injects a tool call straight into the gateway, as a compromised or prompt-injected agent would. Nothing here goes through the model, so the result shows what the policy engine alone enforces. Results are logged to the audit chain.</p>
            <div className="mt-2 divide-y divide-line">
              {Object.entries(RED_TEAM_PROBES).map(([k, p]) => (
                <RedTeamProbe key={k} probe={k} label={p.label} tool={p.tool} agent={getAgent(p.agent)?.name ?? p.agent} />
              ))}
            </div>
          </Card>
          <Card title="Demo controls">
            <p className="mb-3 text-xs text-muted">Moving the clock marks invoices overdue, settles simulated payouts and runs scheduled agents for the new day.</p>
            <DemoControls />
          </Card>
        </div>
      </div>
    </>
  );
}
