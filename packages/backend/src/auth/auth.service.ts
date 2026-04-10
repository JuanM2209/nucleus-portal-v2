import { Injectable, Inject, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { DATABASE } from '../database/database.module';
import { users, refreshTokens, userRoles, roles, invitations } from '../database/schema';
import { eq, and, isNull } from 'drizzle-orm';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly jwtService: JwtService,
  ) {}

  async registerUser(
    tenantId: string,
    email: string,
    password: string,
    displayName?: string,
    roleName?: string,
  ) {
    // Check if user already exists in this tenant
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), eq(users.tenantId, tenantId)))
      .limit(1);

    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [newUser] = await this.db
      .insert(users)
      .values({
        tenantId,
        email,
        passwordHash,
        displayName: displayName ?? null,
      })
      .returning();

    // Assign role if specified
    if (roleName) {
      const [role] = await this.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, roleName))
        .limit(1);

      if (role) {
        await this.db.insert(userRoles).values({
          userId: newUser.id,
          roleId: role.id,
        });
      }
    }

    return {
      id: newUser.id,
      email: newUser.email,
      displayName: newUser.displayName,
      tenantId: newUser.tenantId,
    };
  }

  // ── Invitations ──

  async createInvitation(tenantId: string, invitedBy: string, email: string, role: string) {
    // Check if user already exists
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), eq(users.tenantId, tenantId)))
      .limit(1);

    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    // Check for pending invitation
    const [pendingInvite] = await this.db
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(
        eq(invitations.email, email),
        eq(invitations.tenantId, tenantId),
        isNull(invitations.acceptedAt),
      ))
      .limit(1);

    if (pendingInvite) {
      throw new ConflictException('An invitation for this email is already pending');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [invitation] = await this.db
      .insert(invitations)
      .values({ tenantId, email, role, token, invitedBy, expiresAt })
      .returning();

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(token: string, displayName: string, password: string) {
    const [invitation] = await this.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.token, token), isNull(invitations.acceptedAt)))
      .limit(1);

    if (!invitation) {
      throw new NotFoundException('Invitation not found or already used');
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    // Create the user
    const user = await this.registerUser(
      invitation.tenantId,
      invitation.email,
      password,
      displayName,
      invitation.role,
    );

    // Mark invitation as accepted
    await this.db
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));

    return user;
  }

  async getPendingInvitations(tenantId: string) {
    return this.db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(and(
        eq(invitations.tenantId, tenantId),
        isNull(invitations.acceptedAt),
      ))
      .orderBy(invitations.createdAt);
  }

  async getInvitationByToken(token: string) {
    const [invitation] = await this.db
      .select({
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
      })
      .from(invitations)
      .where(eq(invitations.token, token))
      .limit(1);

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.acceptedAt) {
      throw new BadRequestException('Invitation has already been used');
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    return { email: invitation.email, role: invitation.role };
  }

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
