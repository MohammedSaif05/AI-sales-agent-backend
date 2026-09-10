import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException('User authentication context is missing');
    }

    // Super Admin has global access to roles
    if (user.systemRole === 'SUPER_ADMIN') {
      return true;
    }

    // Check systemRole or businessRole against required roles
    const hasRole = requiredRoles.some(
      (role) => role === user.systemRole || role === user.businessRole,
    );

    if (!hasRole) {
      throw new ForbiddenException(
        `Forbidden resource: Required role in [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
