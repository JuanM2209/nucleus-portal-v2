import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const DATABASE = Symbol('DATABASE');

const databaseProvider = {
  provide: DATABASE,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const connectionString = config.get<string>('DATABASE_URL')
      || 'postgres://nucleus:nucleus_dev@localhost:6432/nucleus';

    const client = postgres(connectionString, {
      max: 20,
      idle_timeout: 20,
      connect_timeout: 10,
    });

    return drizzle(client);
  },
};

@Global()
@Module({
  providers: [databaseProvider],
  exports: [DATABASE],
})
export class DatabaseModule {}
