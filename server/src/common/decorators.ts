import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export const PUBLIC_KEY = "relay:public";
/** 인증 없이 받는 경로(health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const SKIP_IDEMPOTENCY_KEY = "relay:skip-idempotency";
/** `Idempotency-Key`가 와도 응답을 보관하지 않는 경로. 읽기 전용 POST(검색)와 색인 워커의 요청은 응답이 크고(조각 글·벡터), 보관하면 낡은 결과를 되돌려 준다. */
export const SkipIdempotency = () => SetMetadata(SKIP_IDEMPOTENCY_KEY, true);

/** 토큰이 가리키는 사용자·토큰·(헤더로 밝힌) 기기. 가드가 요청에 붙인다. */
export interface AuthContext { userId: string; tokenId: string; deviceId: string | null }

export type AuthedRequest = Request & { relayAuth?: AuthContext };

export const Auth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<AuthedRequest>();
  if (!request.relayAuth) throw new Error("인증 맥락이 없습니다. AuthGuard가 적용된 경로에서만 Auth를 쓰세요.");
  return request.relayAuth;
});
