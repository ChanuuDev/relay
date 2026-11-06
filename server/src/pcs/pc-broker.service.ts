import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { RelayError } from "@relay/core";

/*
 * PC 파일 중계. 브라우저는 집·회사 PC에 직접 닿을 수 없으므로, PC에서 도는 relay.exe(원격 모드의 `relay web`)가
 * `GET /api/v1/agent/next`로 먼저 기다리고 있다가 서버가 건네는 요청을 받아 처리하고, 응답 바이트를 `POST /api/v1/agent/reply/:id`로 흘려보낸다.
 * 서버는 그 흐름을 기다리던 브라우저 응답에 그대로 잇는다(버퍼에 담지 않는다). 서버 한 대라 기억 속 대기열이면 된다.
 */

/** PC가 처리할 요청 하나. PC에는 이 모양 그대로 JSON으로 간다. */
export interface PcJob { id: string; method: "GET" | "POST"; path: string; query: string; headers: Record<string, string>; body: string | null }
/** PC가 돌려준 응답: 상태·허용한 헤더와 본문 흐름 */
export interface PcReply { status: number; headers: Record<string, string>; body: Readable }

interface Pending {
  job: PcJob; userId: string; deviceId: string;
  /** PC가 응답을 보내기 시작하면 부른다. 브라우저 응답에 다 잇고 나면 끝난다. */
  deliver: (reply: PcReply) => Promise<void>;
  fail: (error: RelayError) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface Waiter { userId: string; resolve: (job: PcJob | null) => void }

/** PC가 요청을 가져가기를 기다리는 시간. 넘으면 PC가 꺼진 것으로 본다. */
export const PICK_MS = 15_000;
/** PC가 요청을 가져간 뒤 응답을 보내기 시작할 때까지의 시간 */
export const REPLY_MS = 60_000;
/** 마지막 대기 이후 이 시간 안이면 연결된 PC로 본다. PC는 25초씩 기다리고 곧바로 다시 기다린다. */
export const ONLINE_MS = 40_000;
const MAX_QUEUE = 64;

@Injectable()
export class PcBroker {
  private readonly queues = new Map<string, Pending[]>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly picked = new Map<string, Pending>();
  private readonly seen = new Map<string, number>();

  /** 그 사용자의 PC가 지금 기다리고 있거나 방금까지 기다렸다. */
  online(deviceId: string, now = Date.now()) {
    return (this.waiters.get(deviceId)?.size ?? 0) > 0 || now - (this.seen.get(deviceId) ?? 0) < ONLINE_MS;
  }

  /** 브라우저 쪽: 요청을 PC에 맡기고, PC가 응답을 보내기 시작하면 deliver가 불린다. 돌려준 약속은 다 이은 뒤 끝난다. */
  submit(userId: string, deviceId: string, job: Omit<PcJob, "id">, deliver: (reply: PcReply) => Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!this.online(deviceId)) return Promise.reject(new RelayError("PC_OFFLINE", "PC가 연결돼 있지 않습니다. 그 PC에서 Relay가 원격 모드로 켜져 있는지 확인하세요.", 7, 503));
    const queue = this.queues.get(deviceId) ?? [];
    if (queue.length >= MAX_QUEUE) return Promise.reject(new RelayError("PC_BUSY", "PC에 보낸 요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.", 7, 503));
    return new Promise<void>((resolve, reject) => {
      const pending: Pending = {
        job: { ...job, id: randomUUID() }, userId, deviceId,
        deliver: async (reply) => { clearTimeout(pending.timer); this.picked.delete(pending.job.id); try { await deliver(reply); resolve(); } catch (error) { reject(error); } },
        fail: (error) => { clearTimeout(pending.timer); this.picked.delete(pending.job.id); this.drop(pending); reject(error); },
        timer: setTimeout(() => pending.fail(new RelayError("PC_TIMEOUT", "PC가 응답하지 않습니다. PC가 잠들었거나 연결이 끊겼는지 확인하세요.", 7, 504)), PICK_MS),
      };
      // 브라우저가 먼저 떠나면(창을 닫거나 다른 폴더로 감) PC에 넘기기 전이면 대기열에서 빼고, 넘긴 뒤면 응답을 받을 곳이 없다고 본다.
      signal?.addEventListener("abort", () => { if (this.picked.has(pending.job.id) || queue.includes(pending)) pending.fail(new RelayError("CANCELLED", "요청을 취소했습니다.", 2, 499)); }, { once: true });
      const waiter = this.takeWaiter(deviceId, userId);
      if (waiter) this.hand(pending, waiter);
      else { queue.push(pending); this.queues.set(deviceId, queue); }
    });
  }

  /** PC가 요청을 받기 전에 연결이 끊겼다. 그 요청은 실패로 돌려 브라우저가 오래 기다리지 않게 한다. */
  abandon(id: string) {
    this.picked.get(id)?.fail(new RelayError("PC_TIMEOUT", "PC와의 연결이 끊겼습니다. 다시 시도하세요.", 7, 504));
  }

  /** PC 쪽: 맡길 요청을 기다린다. waitMs 안에 없으면 null. signal이 끊기면(PC가 연결을 닫음) 그만 기다린다. */
  next(userId: string, deviceId: string, waitMs: number, signal: AbortSignal): Promise<PcJob | null> {
    this.seen.set(deviceId, Date.now());
    const queue = this.queues.get(deviceId);
    const index = queue?.findIndex((item) => item.userId === userId) ?? -1;
    if (queue && index >= 0) {
      const [pending] = queue.splice(index, 1);
      return Promise.resolve(this.pick(pending!));
    }
    return new Promise((resolve) => {
      const set = this.waiters.get(deviceId) ?? new Set<Waiter>();
      const finish = (job: PcJob | null) => { clearTimeout(timer); set.delete(waiter); this.seen.set(deviceId, Date.now()); resolve(job); };
      const waiter: Waiter = { userId, resolve: finish };
      const timer = setTimeout(() => finish(null), waitMs);
      signal.addEventListener("abort", () => finish(null), { once: true });
      set.add(waiter);
      this.waiters.set(deviceId, set);
    });
  }

  /** PC 쪽: 가져간 요청의 응답을 넘긴다. 그 PC가 가져간 요청이 아니면 undefined. */
  reply(userId: string, deviceId: string, id: string): Pending | undefined {
    const pending = this.picked.get(id);
    return pending && pending.userId === userId && pending.deviceId === deviceId ? pending : undefined;
  }

  private takeWaiter(deviceId: string, userId: string) {
    for (const waiter of this.waiters.get(deviceId) ?? []) if (waiter.userId === userId) return waiter;
    return undefined;
  }

  private hand(pending: Pending, waiter: Waiter) { waiter.resolve(this.pick(pending)); }

  private pick(pending: Pending): PcJob {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => pending.fail(new RelayError("PC_TIMEOUT", "PC가 응답을 보내지 않았습니다.", 7, 504)), REPLY_MS);
    this.picked.set(pending.job.id, pending);
    return pending.job;
  }

  private drop(pending: Pending) {
    const queue = this.queues.get(pending.deviceId);
    if (!queue) return;
    const index = queue.indexOf(pending);
    if (index >= 0) queue.splice(index, 1);
  }
}
