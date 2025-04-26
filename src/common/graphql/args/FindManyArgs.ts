import { Field, ArgsType } from '@nestjs/graphql';

@ArgsType()
export class FindManyArgs {
  @Field({ nullable: true })
  take?: number;

  @Field({ nullable: true })
  skip?: number;
}
