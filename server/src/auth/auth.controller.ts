import { Controller, Get, Query } from "@nestjs/common";
import { RelayError, type WhoAmI } from "@relay/core";
import { Auth, type AuthContext } from "../common/decorators.js";
import { AuthService } from "./auth.service.js";

@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 연결 테스트가 토큰을 확인할 때 쓴다. */
  @Get("whoami")
  whoami(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>): Promise<WhoAmI> {
    if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", "whoami는 query를 받지 않습니다.");
    return this.auth.whoami(auth.userId, auth.tokenId);
  }
}
