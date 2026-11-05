import { testRemoteConnection } from "@relay/core";
import type { ConnectionReport } from "../shared/types";
export function testConnection(input: { url: string; token: string; deviceName: string; register?: boolean }): Promise<ConnectionReport> {
  return testRemoteConnection(input, { allowHttp: process.env.RELAY_ALLOW_HTTP === "1", platform: process.platform });
}
