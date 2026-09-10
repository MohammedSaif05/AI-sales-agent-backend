import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException('User is not authenticated');
    }

    // Super Admin does not require a fixed tenant bound to request
    if (user.systemRole === 'SUPER_ADMIN') {
      return true;
    }

    if (!user.businessId) {
      throw new ForbiddenException(
        'Access denied: User does not belong to any active business tenant',
      );
    }

    return true;
  }
}
