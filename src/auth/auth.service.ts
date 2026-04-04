import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHmac } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service.js';
import { RedisService } from '@/redis/redis.service.js';
import type { StringValue } from 'ms';
import type { JwtPayload } from '@/common/interfaces/index.js';
import { Role } from '@/common/enums/index.js';
import { RegisterDto, LoginDto, AuthResponseDto } from './dtos/index.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
      },
    });

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      role: user.role as Role,
    });

    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      role: user.role as Role,
    });

    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async refreshTokens(
    userId: string,
    refreshToken: string,
  ): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.refreshToken) {
      throw new ForbiddenException('Access denied');
    }

    const isRefreshTokenValid = await bcrypt.compare(
      refreshToken,
      user.refreshToken,
    );

    if (!isRefreshTokenValid) {
      throw new ForbiddenException('Access denied');
    }

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      role: user.role as Role,
    });

    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return { message: 'If an account with that email exists, a reset link has been sent.' };
    }

    // Generate reset token
    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(resetToken);

    // Store in Redis with 1 hour TTL - store token hash as field, user ID as value for O(1) lookup
    await this.redis.set(
      `password-reset:${tokenHash}`,
      user.id,
      'EX',
      3600,
    );

    // In production, send email with reset link containing the token
    this.logger.log(
      `Password reset requested for ${email}. Reset token generated and would be sent via email in production.`,
    );

    return { message: 'If an account with that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    // Hash the incoming token to look up the stored hash
    const tokenHash = this.hashResetToken(token);
    const redisKey = `password-reset:${tokenHash}`;
    
    // O(1) lookup - no scanning needed
    const userId = await this.redis.get(redisKey);

    if (!userId) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        refreshToken: null, // Invalidate all existing sessions
      },
    });

    // Remove used token
    await this.redis.del(redisKey);

    return { message: 'Password has been reset successfully. Please log in with your new password.' };
  }

  private hashResetToken(token: string): string {
    // Use HMAC-SHA256 for deterministic hashing with a secret key
    // This allows O(1) Redis lookup while preventing offline brute-force
    const secret = this.configService.get<string>('auth.accessSecret')!;
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  private async generateTokens(payload: JwtPayload) {
    const accessExpiration = this.configService.get<string>('auth.accessExpiration', '15m') as StringValue;
    const refreshExpiration = this.configService.get<string>('auth.refreshExpiration', '7d') as StringValue;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload as unknown as Record<string, unknown>, {
        secret: this.configService.get<string>('auth.accessSecret'),
        expiresIn: accessExpiration,
      }),
      this.jwtService.signAsync(payload as unknown as Record<string, unknown>, {
        secret: this.configService.get<string>('auth.refreshSecret'),
        expiresIn: refreshExpiration,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(userId: string, refreshToken: string) {
    const hashedToken = await bcrypt.hash(refreshToken, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedToken },
    });
  }
}
