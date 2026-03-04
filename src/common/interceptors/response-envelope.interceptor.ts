import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestLike>();

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        meta: {
          path: request.url,
          method: request.method,
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}

type RequestLike = {
  method: string;
  url: string;
};
