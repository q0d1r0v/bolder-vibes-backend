import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';

import { LoginDto } from '@/auth/dto/login.dto';
import { RegisterDto } from '@/auth/dto/register.dto';
import type { AuthenticatedUser } from '@/auth/interfaces/authenticated-user.interface';
import type { JwtPayload } from '@/auth/interfaces/jwt-payload.interface';
import { UserRole } from '@/common/enums/user-role.enum';
import { getAppConfig } from '@/config/app.config';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly config = getAppConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (existingUser?.passwordHash) {
      throw new ConflictException('User with this email already exists.');
    }

    const passwordHash = await hash(dto.password, this.config.bcryptRounds);
    const user = existingUser
      ? await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            displayName: dto.displayName?.trim(),
            passwordHash,
          },
          select: userSelect,
        })
      : await this.prisma.user.create({
          data: {
            email: dto.email.toLowerCase(),
            displayName: dto.displayName?.trim(),
            passwordHash,
          },
          select: userSelect,
        });

    return this.createAuthResponse({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role as UserRole,
    });
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: {
        ...userSelect,
        passwordHash: true,
      },
    });

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isValidPassword = await compare(dto.password, user.passwordHash);

    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return this.createAuthResponse({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role as UserRole,
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });

    if (!user) {
      throw new UnauthorizedException('Authentication user was not found.');
    }

    return user;
  }

  private createAuthResponse(user: AuthenticatedUser) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      expiresIn: this.config.jwtExpiresIn,
      user,
    };
  }
}

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
} as const;
