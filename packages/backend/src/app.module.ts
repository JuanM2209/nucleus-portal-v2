import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { DevicesModule } from './devices/devices.module';
import { AgentGatewayModule } from './agent-gateway/agent-gateway.module';
import { TunnelsModule } from './tunnels/tunnels.module';
import { StreamBridgeModule } from './tunnels/stream-bridge.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { ScannerModule } from './scanner/scanner.module';
import { DatabaseModule } from './database/database.module';
import { OrgsModule } from './orgs/orgs.module';
import { SettingsModule } from './settings/settings.module';
import { LogsModule } from './logs/logs.module';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 60,
    }]),
    DatabaseModule,
    StreamBridgeModule,
    AuthModule,
    DevicesModule,
    AgentGatewayModule,
    TunnelsModule,
    AuditModule,
    HealthModule,
    DiscoveryModule,
    ScannerModule,
    OrgsModule,
    SettingsModule,
    LogsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
