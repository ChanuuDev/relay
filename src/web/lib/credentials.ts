import type { Credentials } from "./remote-api";

/* 브라우저 모드의 로그인 정보 보관. 주소와 토큰을 AES-GCM(256비트)으로 암호화해 localStorage에 두고,
   키는 내보낼 수 없는(extractable: false) CryptoKey로 만들어 IndexedDB에만 둔다. 저장소 파일이나 localStorage를 복사해 가도
   키 없이는 토큰을 읽을 수 없고, 스크립트도 키 바이트를 꺼낼 수 없다. 로그아웃하면 암호문과 키를 함께 지운다. */

export const CREDENTIALS_ITEM = "relay-web-credentials";
const DATABASE = "relay-web";
const STORE = "keys";
const KEY_ID = "credentials";

const bytes = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const base64 = (data: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(data)));

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB를 열 수 없습니다."));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openStore().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("IndexedDB 작업에 실패했습니다.")); };
  }));
}

async function encryptionKey(create: boolean): Promise<CryptoKey | null> {
  const saved = await run<CryptoKey | undefined>("readonly", (store) => store.get(KEY_ID) as IDBRequest<CryptoKey | undefined>);
  if (saved || !create) return saved ?? null;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await run("readwrite", (store) => store.put(key, KEY_ID));
  return key;
}

const valid = (value: unknown): value is Credentials => {
  const item = value as Partial<Credentials> | null;
  return Boolean(item && typeof item.url === "string" && typeof item.token === "string" && item.url && item.token);
};

/** 로그인 정보를 암호화해 저장한다. 키가 없으면 새로 만든다. */
export async function saveCredentials(credentials: Credentials): Promise<void> {
  const key = await encryptionKey(true);
  if (!key) throw new Error("암호화 키를 만들 수 없습니다.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ v: 1, ...credentials, savedAt: new Date().toISOString() }));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  localStorage.setItem(CREDENTIALS_ITEM, JSON.stringify({ v: 1, alg: "AES-GCM", iv: base64(iv), data: base64(data) }));
}

/** 저장한 로그인 정보. 없거나 키가 사라져(사이트 데이터 삭제 등) 풀 수 없으면 null이다. */
export async function loadCredentials(): Promise<Credentials | null> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(CREDENTIALS_ITEM); } catch { return null; }
  if (!raw) return null;
  try {
    const sealed = JSON.parse(raw) as { v?: number; iv?: string; data?: string };
    if (sealed.v !== 1 || !sealed.iv || !sealed.data) return null;
    const key = await encryptionKey(false);
    if (!key) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(sealed.iv) }, key, bytes(sealed.data));
    const value = JSON.parse(new TextDecoder().decode(plain)) as Credentials & { v?: number };
    return valid(value) ? { url: value.url, token: value.token, ...(value.user ? { user: value.user } : {}), ...(value.tokenName ? { tokenName: value.tokenName } : {}) } : null;
  } catch { return null; }
}

/** 로그아웃. 암호문과 키를 함께 지운다. 다음 로그인 때 새 키를 만든다. */
export async function clearCredentials(): Promise<void> {
  try { localStorage.removeItem(CREDENTIALS_ITEM); } catch { /* 저장소가 막혀 있으면 지울 것도 없다. */ }
  try { await run("readwrite", (store) => store.delete(KEY_ID)); } catch { /* 키가 남아도 암호문이 없으면 쓸모가 없다. */ }
}
