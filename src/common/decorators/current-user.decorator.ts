import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  phone: string;
  systemRole: 'USER' | 'SUPER_ADMIN';
  businessId?: string;
  businessRole?: 'OWNER' | 'STAFF';
  sessionId: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
