import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedUser } from './current-user.decorator';

export const CurrentBusinessId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user || !user.businessId) {
      throw new UnauthorizedException(
        'No active business context found for this user',
      );
    }

    return user.businessId;
  },
);
