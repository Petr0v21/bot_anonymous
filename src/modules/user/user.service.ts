import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prismaService: PrismaService) {}

  async find(args: Prisma.UserFindManyArgs) {
    return this.prismaService.user.findMany(args);
  }

  async findUnique(args: Prisma.UserFindUniqueArgs) {
    return this.prismaService.user.findUnique(args);
  }

  async upsert(args: Prisma.UserUpsertArgs) {
    return this.prismaService.user.upsert(args);
  }

  async update(args: Prisma.UserUpdateArgs) {
    return this.prismaService.user.update(args);
  }

  async delete(args: Prisma.UserDeleteArgs) {
    return this.prismaService.user.delete(args);
  }
}
