import type { Monster } from "../types/monster";
import { looksLikeMonster } from "./generatedStore";
import {
  UNREACHABLE_MESSAGE,
  type ForgeStatus,
  type GenerateRequest,
  type Generator,
  type GeneratorFailure,
  type GeneratorResult,
  type BorrowOption,
  type GraftOptionsResult,
  type ReskinRequest,
} from "./generatorApi";

// The generator that talks to the Creature Cauldron server (backend/src/cauldron/service). It is the third
// implementation of the Generator interface, next to the offline and demo ones, so the rest of the page does not know
// or care which one it has. Everything the server sends back is checked before the page uses it.

const API_PATH = "/api/v1";
// A request may make the server try up to three AI calls, so it gets a long time before the page gives up.
const DEFAULT_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 10_000;
const KNOWN_REASONS: readonly GeneratorFailure[] = ["offline", "resting", "rate-limited", "invalid", "error"];
const GENERAL_RATE_LIMIT = "Slow down a little: try again in a minute.";

export interface HttpOptions {
  /** Replaceable so tests need no network. */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** The server address joined to an endpoint, without doubled slashes: ("http://x/", "/health") gives "http://x/api/v1/health". */
export function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${API_PATH}${path}`;
}

/** The message for a rate limit, using the server's Retry-After seconds when it gave a usable number. */
export function retryAfterMessage(retryAfter: string | null): string {
  if (retryAfter === null || !/^\d+$/.test(retryAfter) || Number(retryAfter) <= 0) return GENERAL_RATE_LIMIT;
  const seconds = Number(retryAfter);
  if (seconds < 60) return `Slow down a little: try again in about ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
  const minutes = Math.round(seconds / 60);
  return `Slow down a little: try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** What came back from a request: the status, the Retry-After header, and the JSON body (null when it was not JSON). */
export interface JsonAnswer {
  status: number;
  ok: boolean;
  retryAfter: string | null;
  data: unknown;
}

/**
 * One request, answered. The time limit covers the whole answer, body included, so a server that sends its headers and then
 * stalls cannot hang the page. It rejects if the server cannot be reached or does not finish in time.
 */
export async function fetchJson(url: string, init: RequestInit, options: HttpOptions): Promise<JsonAnswer> {
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal });
    const data: unknown = await response.json().catch((error: unknown) => {
      if (controller.signal.aborted) throw error; // the time ran out while the body was still arriving
      return null; // not JSON: callers fall back on the status
    });
    return { status: response.status, ok: response.ok, retryAfter: response.headers.get("retry-after"), data };
  } finally {
    clearTimeout(timer);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const BORROW_KINDS = ["movement", "sense", "trait", "attack", "damage"];
const isBorrowOption = (value: unknown): value is BorrowOption =>
  isObject(value) && typeof value.key === "string" && typeof value.label === "string" && BORROW_KINDS.includes(value.kind as string);

function failure(reason: GeneratorFailure, message: string): GeneratorResult {
  return { ok: false, reason, message };
}

/** Turns an HTTP answer into a GeneratorResult. The body is untrusted, so each part is checked. */
function toResult(status: number, data: unknown, retryAfter: string | null): GeneratorResult {
  if (isObject(data) && data.ok === true) {
    if (!looksLikeMonster(data.monster)) return failure("error", "The server sent back something that couldn't be shown.");
    const notes = Array.isArray(data.notes) ? data.notes.filter((n): n is string => typeof n === "string") : [];
    return { ok: true, monster: data.monster as Monster, notes };
  }
  if (isObject(data) && data.ok === false && typeof data.reason === "string" && (KNOWN_REASONS as readonly string[]).includes(data.reason)) {
    const reason = data.reason as GeneratorFailure;
    const message = typeof data.message === "string" ? data.message : "";
    return failure(reason, reason === "rate-limited" && retryAfter !== null ? retryAfterMessage(retryAfter) : message);
  }
  // The body could not be read (for example an error page from a proxy), so the status has to do.
  if (status === 429) return failure("rate-limited", retryAfterMessage(retryAfter));
  if (status === 503) return failure("resting", "");
  if (status === 422) return failure("invalid", "");
  return failure("error", "The forge sent an answer the page could not read.");
}

export function createLiveGenerator(baseUrl: string, options: HttpOptions = {}): Generator {
  async function post(path: string, body: unknown): Promise<GeneratorResult> {
    try {
      const answer = await fetchJson(
        apiUrl(baseUrl, path),
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        options,
      );
      return toResult(answer.status, answer.data, answer.retryAfter);
    } catch {
      // The page could not reach the server at all, or it took too long. The reason is still "offline", but the message says
      // that a server is configured and is not answering, so it is not mistaken for a page with no server.
      return failure("offline", UNREACHABLE_MESSAGE);
    }
  }

  return {
    mode: "live",

    generate: (request: GenerateRequest) => post("/generate", { ...request, excludeIds: request.excludeIds ?? [] }),

    // Only the id goes to the server. It loads the monster itself, so none of the monster's text can reach the AI.
    reskin: (request: ReskinRequest) =>
      post("/reskin", {
        baseId: request.base.id,
        theme: request.theme ?? null,
        damageOnly: request.damageOnly ?? false,
        move: request.move ?? null,
        levelUp: request.levelUp ?? false,
        reflavor: request.reflavor ?? false,
        donorId: request.donorId ?? null,
        borrow: request.borrow ?? [],
        forgeChooses: request.forgeChooses ?? false,
      }),

    async graftOptions(baseId: string, donorId: string): Promise<GraftOptionsResult> {
      try {
        const answer = await fetchJson(
          apiUrl(baseUrl, "/graft/options"),
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseId, donorId }) },
          options,
        );
        if (isObject(answer.data) && answer.data.ok === true && Array.isArray(answer.data.options)) {
          return { ok: true, options: answer.data.options.filter(isBorrowOption) };
        }
        const result = toResult(answer.status, answer.data, answer.retryAfter);
        if (result.ok) return { ok: false, reason: "error", message: "The forge sent an answer the page could not read." };
        return result;
      } catch {
        return { ok: false, reason: "offline", message: UNREACHABLE_MESSAGE };
      }
    },

    async status(): Promise<ForgeStatus> {
      try {
        const { ok, data } = await fetchJson(apiUrl(baseUrl, "/health"), { method: "GET" }, { ...options, timeoutMs: options.timeoutMs ?? HEALTH_TIMEOUT_MS });
        if (ok && isObject(data) && (data.status === "ok" || data.status === "resting")) return data.status;
      } catch {
        // fall through: offline
      }
      return "offline";
    },
  };
}
