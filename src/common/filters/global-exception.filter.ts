import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

interface ExceptionResponse {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
  timestamp: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isDebug = this.configService.get<boolean>('app.debug');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || message;
        error = (resp.error as string) || error;
        details = resp.details;
      }
      error = HttpStatus[status] || error;
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError
    ) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          error = 'Conflict';
          message = 'A record with this value already exists';
          details = { fields: exception.meta?.target };
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          error = 'Not Found';
          message = 'Record not found';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          error = 'Bad Request';
          message = 'Database operation failed';
      }
    } else if (exception instanceof Error) {
      message = isDebug ? exception.message : 'Internal server error';
    }

    const errorResponse: ExceptionResponse = {
      statusCode: status,
      error,
      message,
      details,
      requestId: (request as unknown as Record<string, unknown>).requestId as string,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} ${status} - ${message}`);
    }

    response.status(status).json(errorResponse);
  }
}
