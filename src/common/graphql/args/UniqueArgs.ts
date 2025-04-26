import { Field, ArgsType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';

@ArgsType()
export class UniqueArgs {
  @Field()
  @IsUUID()
  id: string;
}
