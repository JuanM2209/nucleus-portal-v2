import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { DATABASE } from '../database/database.module';
import { users, refreshTokens, userRoles, roles } from '../database/schema';
import { eq, and, isNull } from 'drizzle-orm';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string, tenantId?: string) {
    // Scope login by tenant to prevent cross-tenant auth collisions
    const conditions = [eq(users.email, email)];
    if (tenantId) {
      conditions.push(eq(users.tenantId, tenantId));
    }
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(...conditions))
      .limit(1);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Get user roles
    const userRoleRecords = await this.db
      .select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));

    const roleNames = userRoleRecords.map((r: any) => r.name);

    // Generate tokens
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roles: roleNames,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.createRefreshToken(user.id);

    // Update last login
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        tenantId: user.tenantId,
        roles: roleNames,
      },
    };
  }

  async refreshTokens(token: string) {
    const tokenHash = this.hashToken(token);

    const [stored] = await this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .limit(1);

    if (!stored || new Date(stored.expiresAt) < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke old token
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    // Get user and generate new tokens
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, stored.userId))
      .limit(1);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is inactive');
    }

    const userRoleRecords = await this.db
      .select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));

    const roleNames = userRoleRecords.map((r: any) => r.name);

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roles: roleNames,
    };

    const accessToken = this.jwtService.sign(payload);
    const newRefreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900,
    };
  }

  async revokeRefreshToken(token: string) {
    const tokenHash = this.hashToken(token);
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  }

  /** Revoke a refresh token only if it belongs to the given user (prevents cross-user revocation) */
  async revokeRefreshTokenForUser(userId: string, token: string) {
    const tokenHash = this.hashToken(token);
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  private async createRefreshToken(userId: string): Promise<string> {
    // Revoke all previous refresh tokens for this user (max 1 active session)
    // This prevents unbounded token accumulation and limits concurrent sessions
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
        ),
      );

    const token = randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.insert(refreshTokens).values({
      userId,
      tokenHash,
      expiresAt,
    });

    return token;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
