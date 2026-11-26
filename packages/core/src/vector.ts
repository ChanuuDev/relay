// 임베딩 벡터를 다루는 작은 함수들. 벡터는 길이 1로 맞춘 Float32Array로 다루고, 저장과 전송은 float32(리틀 엔디언) 바이트와 그 base64로 한다.

/** 길이를 1로 맞춘다. 0-벡터이거나 NaN·Infinity가 섞였으면 null(코사인 정렬이 깨지므로 받지 않는다). */
export function unit(values: ArrayLike<number>): Float32Array | null {
  let sum = 0;
  for (let i = 0; i < values.length; i++) { const value = values[i]!; if (!Number.isFinite(value)) return null; sum += value * value; }
  if (!(sum > 0)) return null;
  const norm = Math.sqrt(sum), out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i]! / norm;
  return out;
}

/** 앞 dims개만 남기고 다시 길이를 맞춘다(Matryoshka 표현 학습 모델은 앞쪽 차원만으로도 뜻을 담는다). 이미 그 길이면 길이만 맞춘다. */
export function fit(values: ArrayLike<number>, dims: number): Float32Array | null {
  if (values.length < dims) return null;
  return unit(values.length === dims ? values : Array.prototype.slice.call(values, 0, dims) as number[]);
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

export const vectorBytes = (vector: Float32Array): Uint8Array => new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
/** 저장된 바이트를 벡터로. 바이트 수가 4의 배수가 아니면 null. 복사해서 돌려주므로 원래 버퍼의 정렬·수명과 무관하다. */
export function bytesVector(bytes: Uint8Array): Float32Array | null {
  if (!bytes.byteLength || bytes.byteLength % 4) return null;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export function encodeVector(vector: Float32Array): string {
  const bytes = vectorBytes(vector);
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/** base64를 벡터로. 모양이 틀렸거나 길이가 dims와 다르거나 길이 1인 유한한 벡터가 아니면 null. */
export function decodeVector(data: unknown, dims: number): Float32Array | null {
  if (typeof data !== "string" || !data || data.length > dims * 6 + 8) return null;
  let text: string;
  try { text = atob(data); } catch { return null; }
  if (text.length !== dims * 4) return null;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  const vector = new Float32Array(bytes.buffer);
  let sum = 0;
  for (let i = 0; i < vector.length; i++) { const value = vector[i]!; if (!Number.isFinite(value)) return null; sum += value * value; }
  // 보내는 쪽이 길이를 맞춰 보내지만, 조금 어긋난 것은 여기서 다시 맞춘다. 크게 어긋났으면 잘못된 값으로 본다.
  if (sum < 0.5 || sum > 2) return null;
  return Math.abs(sum - 1) < 1e-4 ? vector : unit(vector);
}
