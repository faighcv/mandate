import crypto from "node:crypto";
import { getSetting, setSetting } from "../db";

/**
 * Visa Trusted Agent Protocol (TAP) signing for agent-to-merchant requests.
 * RFC 9421 HTTP Message Signatures over "@authority" and "@path" with Ed25519, label sig2,
 * tag agent-browser-auth (browsing, quotes) or agent-payer-auth (checkout), max 8-minute validity.
 * Visa's published examples differ in serialisation details, so both sides here use strict RFC 9421.
 */
export type TapTag = "agent-browser-auth" | "agent-payer-auth";

const MAX_WINDOW_S = 480;

interface StoredKey {
  kid: string;
  agentId: string;
  privatePem: string;
  publicJwk: { kty: string; crv: string; x: string; kid: string; use: string; alg: string };
  created_at: string;
}

function keys(): Record<string, StoredKey> {
  return getSetting<Record<string, StoredKey>>("tap_keys", {});
}

/** Each agent gets its own Ed25519 key; the public half is published at /api/tap/keys/{kid}. */
export function agentKey(agentId: string): StoredKey {
  const all = keys();
  const existing = Object.values(all).find((k) => k.agentId === agentId);
  if (existing) return existing;
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string };
  const kid = crypto.createHash("sha256").update(jwk.x).digest("base64url").slice(0, 43);
  const key: StoredKey = {
    kid,
    agentId,
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicJwk: { ...jwk, kid, use: "sig", alg: "Ed25519" },
    created_at: new Date().toISOString(),
  };
  setSetting("tap_keys", { ...all, [kid]: key });
  return key;
}

export function publicKey(kid: string) {
  return keys()[kid]?.publicJwk;
}

export function listPublicKeys() {
  return Object.values(keys()).map((k) => ({ ...k.publicJwk, agent_id: k.agentId }));
}

function signatureParams(p: { created: number; expires: number; keyid: string; nonce: string; tag: TapTag }) {
  return `("@authority" "@path");created=${p.created};expires=${p.expires};keyid="${p.keyid}";alg="Ed25519";nonce="${p.nonce}";tag="${p.tag}"`;
}

function signatureBase(authority: string, path: string, params: string) {
  return `"@authority": ${authority}\n"@path": ${path}\n"@signature-params": ${params}`;
}

export function signRequest(url: string, agentId: string, tag: TapTag, nonce = crypto.randomBytes(32).toString("base64")) {
  const key = agentKey(agentId);
  const u = new URL(url);
  const created = Math.floor(Date.now() / 1000);
  const params = signatureParams({ created, expires: created + MAX_WINDOW_S, keyid: key.kid, nonce, tag });
  const sig = crypto.sign(null, Buffer.from(signatureBase(u.host, u.pathname, params)), crypto.createPrivateKey(key.privatePem));
  return {
    headers: { "Signature-Input": `sig2=${params}`, Signature: `sig2=:${sig.toString("base64")}:` },
    nonce,
    keyid: key.kid,
  };
}

const seenNonces = new Map<string, number>();

export interface TapVerification {
  ok: boolean;
  reason: string;
  keyid?: string;
  tag?: string;
  agentId?: string;
}

/** Merchant-side verification, following the spec's steps: fields, window, replay, key lookup, signature. */
export function verifyRequest(input: { authority: string; path: string; signatureInput: string | null; signature: string | null; expectTag?: TapTag }): TapVerification {
  if (!input.signatureInput || !input.signature) return { ok: false, reason: "No TAP signature: not a trusted agent." };
  const m = /^sig2=(\("@authority" "@path"\);(.*))$/.exec(input.signatureInput);
  if (!m) return { ok: false, reason: "Signature-Input must cover \"@authority\" and \"@path\" under label sig2." };
  const fields = Object.fromEntries([...m[2].matchAll(/(\w+)=("([^"]*)"|\d+)/g)].map((x) => [x[1], x[3] ?? x[2]]));
  for (const f of ["created", "expires", "keyid", "alg", "nonce", "tag"]) if (!fields[f]) return { ok: false, reason: `Missing ${f}.` };
  const now = Math.floor(Date.now() / 1000);
  const created = Number(fields.created);
  const expires = Number(fields.expires);
  if (created > now + 5 || expires < now || expires - created > MAX_WINDOW_S) return { ok: false, reason: "Signature outside its validity window." };
  if (input.expectTag && fields.tag !== input.expectTag) return { ok: false, reason: `Expected tag ${input.expectTag}, got ${fields.tag}.` };
  for (const [n, t] of seenNonces) if (t < now - MAX_WINDOW_S) seenNonces.delete(n);
  const replayKey = `${fields.nonce}|${fields.tag}|${input.path}`;
  if (seenNonces.has(replayKey)) return { ok: false, reason: "Nonce replayed within 8 minutes." };
  const jwk = publicKey(fields.keyid);
  if (!jwk) return { ok: false, reason: `Unknown key ${fields.keyid}.` };
  const sigB64 = /^sig2=:([^:]+):$/.exec(input.signature)?.[1];
  if (!sigB64) return { ok: false, reason: "Malformed Signature header." };
  const valid = crypto.verify(
    null,
    Buffer.from(signatureBase(input.authority, input.path, m[1])),
    crypto.createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: "jwk" }),
    Buffer.from(sigB64, "base64"),
  );
  if (!valid) return { ok: false, reason: "Signature does not verify against the agent's published key." };
  seenNonces.set(replayKey, now);
  const agentId = keys()[fields.keyid]?.agentId;
  return { ok: true, reason: "Verified TAP signature.", keyid: fields.keyid, tag: fields.tag, agentId };
}
