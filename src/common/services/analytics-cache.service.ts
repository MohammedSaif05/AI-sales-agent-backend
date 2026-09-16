import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class AnalyticsCacheService {
  private readonly logger = new Logger(AnalyticsCacheService.name);
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST') || 'localhost',
      port: this.configService.get<number>('REDIS_PORT') || 6379,
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
    });
    this.redis.connect().catch((err) => {
      this.logger.warn(
        `Redis connection error in AnalyticsCacheService: ${err.message}`,
      );
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (err) {
      this.logger.warn(`Cache get failed for key=${key}: ${err}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Cache set failed for key=${key}: ${err}`);
    }
  }

  async invalidateTenantAnalystCache(businessId: string): Promise<void> {
    try {
      const pattern = `tenant:${businessId}:analyst:*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(
          `Invalidated ${keys.length} analyst cache keys for businessId=${businessId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate analyst cache for businessId=${businessId}: ${err}`,
      );
    }
  }
}
