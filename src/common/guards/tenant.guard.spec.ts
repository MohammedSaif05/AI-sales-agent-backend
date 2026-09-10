import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';

describe('TenantGuard', () => {
  let guard: TenantGuard;

  beforeEach(() => {
    guard = new TenantGuard();
  });

  const mockContext = (user: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  it('should allow user with active businessId', () => {
    const context = mockContext({
      userId: 'user-1',
      systemRole: 'USER',
      businessId: 'business-1',
      businessRole: 'OWNER',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException if user has no businessId and is not super admin', () => {
    const context = mockContext({
      userId: 'user-2',
      systemRole: 'USER',
      businessId: undefined,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow SUPER_ADMIN even without bound businessId', () => {
    const context = mockContext({
      userId: 'admin-1',
      systemRole: 'SUPER_ADMIN',
      businessId: undefined,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException if user is not authenticated at all', () => {
    const context = mockContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
