import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { RelayError, type DeviceList, type DeviceRegistered } from "@relay/core";
import { Auth, type AuthContext } from "../common/decorators.js";
import { DevicesService } from "./devices.service.js";

@Controller("api/v1/devices")
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post("register")
  @HttpCode(200)
  register(@Auth() auth: AuthContext, @Body() body: unknown): Promise<DeviceRegistered> {
    return this.devices.register(auth.userId, auth.tokenId, body);
  }

  @Get()
  list(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>): Promise<DeviceList> {
    if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", "기기 목록은 query를 받지 않습니다.");
    return this.devices.list(auth.userId);
  }
}
