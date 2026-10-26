"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/client";
import { btnPrimary, input, label } from "@/components/ui";
import { addDocumentAction } from "@/app/actions";

export function AddDocument({ categories }: { categories: { key: string; label: string }[] }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("policies");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await addDocumentAction({ title, category, body, tags });
          setTitle("");
          setTags("");
          setBody("");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className={label}>Title</span>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <span className={label}>Category (access scope)</span>
          <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <span className={label}>Tags</span>
        <input className={input} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="collections, acme, contract" />
      </div>
      <div>
        <span className={label}>Content</span>
        <textarea className={`${input} min-h-32`} value={body} onChange={(e) => setBody(e.target.value)} required />
      </div>
      <button className={btnPrimary} disabled={pending || !title || !body}>
        {pending && <Spinner />} Add to Company Brain
      </button>
    </form>
  );
}
