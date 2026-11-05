import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DEVICE_HEADER, RelayError } from "@relay/core";
import { AuthService } from "../auth/auth.service.js";
import { PUBLIC_KEY, type AuthedRequest } from "./decorators.js";

/** health를 뺀 모든 경로는 `Authorization: Bearer <토큰>`이 있어야 한다. 기기 헤더가 있으면 그 사용자의 기기인지 확인한다. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization ?? "";
    const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header);
    if (!match) throw new RelayError("UNAUTHORIZED", "Bearer 토큰이 필요합니다.", 7, 401);
    const found = await this.auth.verify(match[1]);
    if (!found) throw new RelayError("UNAUTHORIZED", "토큰이 올바르지 않거나 폐기되었습니다.", 7, 401);
    const rawDevice = request.headers[DEVICE_HEADER];
    const deviceId = typeof rawDevice === "string" && rawDevice.trim() ? rawDevice.trim() : null;
    if (deviceId !== null) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(deviceId)) throw new RelayError("INVALID_ARGUMENT", "기기 식별자가 올바르지 않습니다.");
      if (!(await this.auth.deviceBelongs(found.userId, deviceId))) throw new RelayError("INVALID_ARGUMENT", "등록되지 않은 기기입니다. 연결 테스트로 기기를 다시 등록하세요.", 2, 400, { deviceId });
    }
    request.relayAuth = { userId: found.userId, tokenId: found.tokenId, deviceId };
    return true;
  }
}
