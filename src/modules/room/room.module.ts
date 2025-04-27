import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { RoomService } from './room.service';
import { ParticipantService } from './participant.service';

@Module({
  imports: [PrismaModule],
  providers: [RoomService, ParticipantService],
  exports: [RoomService, ParticipantService],
})
export class RoomModule {}
