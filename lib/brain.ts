import { all, get, insert } from "./db";
import { id, nowIso } from "./util";

export interface Doc {
  id: string; title: string; category: string; body: string; tags: string | null; customer_id: string | null; source: string; created_at: string;
}

const STOP = new Set("the a an and or of to in on for is are was be with by at as it this that from our we you your".split(" "));
const terms = (s: string) => s.toLowerCase().split(/[^a-z0-9$%.-]+/).filter((t) => t.length > 1 && !STOP.has(t));

/**
 * Company Brain search. Results are filtered to the categories the caller is allowed to see
 * before ranking, so a document outside the mandate never reaches the model.
 */
export function searchBrain(query: string, categories: string[], limit = 5) {
  if (!categories.length) return [];
  const q = terms(query);
  const docs = all<Doc>(`SELECT * FROM documents WHERE category IN (${categories.map(() => "?").join(",")})`, ...categories);
  return docs
    .map((d) => {
      const title = terms(d.title);
      const body = terms(d.body);
      const tags = terms(d.tags ?? "");
      let score = 0;
      for (const t of q) {
        score += title.filter((x) => x === t).length * 3 + tags.filter((x) => x === t).length * 2 + Math.min(body.filter((x) => x === t).length, 5);
      }
      return { d, score };
    })
    .filter((x) => x.score > 0 || !q.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d, score }) => ({ id: d.id, title: d.title, category: d.category, score, excerpt: excerpt(d.body, q) }));
}

function excerpt(body: string, q: string[], len = 700): string {
  const lower = body.toLowerCase();
  const hit = q.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 150);
  return (start > 0 ? "..." : "") + body.slice(start, start + len) + (start + len < body.length ? "..." : "");
}

export const getDoc = (docId: string) => get<Doc>("SELECT * FROM documents WHERE id = ?", docId);

export function addDoc(input: { title: string; category: string; body: string; tags?: string; customerId?: string; source?: string }) {
  const did = id("doc");
  insert("documents", { id: did, title: input.title, category: input.category, body: input.body, tags: input.tags ?? null, customer_id: input.customerId ?? null, source: input.source ?? "upload", created_at: nowIso() });
  return did;
}
