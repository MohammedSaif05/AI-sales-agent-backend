import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponseEnvelope<T> {
  success: true;
  data: T;
  meta?: unknown;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponseEnvelope<T> | T
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponseEnvelope<T> | T> {
    return next.handle().pipe(
      map((res) => {
        // If already structured or buffer or null
        if (res && typeof res === 'object') {
          if ('success' in res && typeof res.success === 'boolean') {
            return res;
          }
          if ('data' in res && 'meta' in res) {
            return {
              success: true,
              data: res.data,
              meta: res.meta,
            };
          }
        }

        return {
          success: true,
          data: res,
        };
      }),
    );
  }
}
