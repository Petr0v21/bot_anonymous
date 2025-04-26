// import { Module, Global } from '@nestjs/common';
// import { RedisStore } from '@type-cacheable/redis-store';
// import { CacheManager } from '@type-cacheable/core';
// import Redis from 'ioredis';

// @Global()
// @Module({})
// export class CacheModule {
//   constructor() {
//     const redis = new Redis({
//       host: process.env.REDIS_HOST ?? 'localhost',
//       port: Number(process.env.REDIS_PORT ?? 6379),
//       password: process.env.REDIS_PASSWORD ?? undefined,
//       db: Number(process.env.REDIS_DB ?? 0),
//     });

//     // Подключаем RedisStore к type-cacheable
//     CacheManager.setStore(new RedisStore(redis));
//   }
// }
