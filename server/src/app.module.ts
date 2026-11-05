import { Module, type DynamicModule, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { CONFIG } from "./app.tokens.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { CalculatorController } from "./calculator/calculator.controller.js";
import { CalculatorService } from "./calculator/calculator.service.js";
import { AuthGuard } from "./common/auth.guard.js";
import { IdempotencyInterceptor } from "./common/idempotency.interceptor.js";
import { RelayErrorFilter } from "./common/relay-error.filter.js";
import { requestLog } from "./common/request-log.js";
import type { ServerConfig } from "./config.js";
import { DatabaseModule, type Db } from "./db/database.js";
import { DevicesController } from "./devices/devices.controller.js";
import { DevicesService } from "./devices/devices.service.js";
import { FilesController } from "./files/files.controller.js";
import { FilesService } from "./files/files.service.js";
import { HealthController } from "./health/health.controller.js";
import { ImportController } from "./import/import.controller.js";
import { ImportService } from "./import/import.service.js";
import { MaintenanceService } from "./maintenance/maintenance.service.js";
import { NotesController } from "./notes/notes.controller.js";
import { NotesService } from "./notes/notes.service.js";
import { SessionsController } from "./sessions/sessions.controller.js";
import { SessionsService } from "./sessions/sessions.service.js";

@Module({})
export class AppModule implements NestModule {
  static forRoot(db: Db, config: ServerConfig, options: { schedule?: boolean; log?: boolean } = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.forRoot(db), ...(options.schedule === false ? [] : [ScheduleModule.forRoot()])],
      controllers: [HealthController, AuthController, DevicesController, SessionsController, NotesController, CalculatorController, FilesController, ImportController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: "RELAY_LOG", useValue: options.log !== false },
        AuthService, DevicesService, SessionsService, NotesService, CalculatorService, FilesService, ImportService, MaintenanceService,
        { provide: APP_FILTER, useClass: RelayErrorFilter },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }

  constructor() {}

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestLog).forRoutes("*path");
  }
}
