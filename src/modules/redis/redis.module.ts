import { DynamicModule, Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { Redis } from 'ioredis';
import { ModuleMetadata, Provider } from '@nestjs/common/interfaces';

export interface RedisModuleOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export interface RedisModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (
    ...args: any[]
  ) => Promise<RedisModuleOptions> | RedisModuleOptions;
  inject?: any[];
}

@Global()
@Module({})
export class RedisModule {
  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    const redisProvider: Provider = {
      provide: 'REDIS_CLIENT',
      useFactory: async (...args: any[]) => {
        const redisOptions = await options.useFactory(...args);
        return new Redis({
          host: redisOptions.host,
          port: redisOptions.port,
          password: redisOptions.password,
          db: redisOptions.db ?? 0,
        });
      },
      inject: options.inject || [],
    };

    return {
      module: RedisModule,
      imports: options.imports || [],
      providers: [redisProvider, RedisService],
      exports: [RedisService],
    };
  }
}
