// 테스트용 임베딩 서버(OpenAI 호환 /v1/embeddings). 뜻을 흉내 내는 벡터를 돌려준다: bun tests/support/fake-embedder.ts <포트> [blind]
// blind를 주면 글의 길이만 보는 벡터를 준다(벡터는 나오지만 뜻을 담지 못하는 서버: 자가 진단이 걸러 내야 한다).
import { FAKE_DIMS, fakeVector } from "../semantic-helpers";

const port = Number(process.argv[2]);
const blind = process.argv[3] === "blind";
let calls = 0;
Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/calls") return Response.json({ calls });
  if (url.pathname !== "/v1/embeddings" || request.method !== "POST") return new Response("not found", { status: 404 });
  const body = await request.json() as { input: string[] };
  calls++;
  return Response.json({ data: body.input.map((text, index) => ({ index,
    embedding: blind ? Array.from({ length: FAKE_DIMS }, (_unused, at) => (at === 0 ? 1 : at === 1 ? text.length % 7 : at === 2 ? text.length % 3 : 0.5)) : [...fakeVector(text)] })) });
} });
