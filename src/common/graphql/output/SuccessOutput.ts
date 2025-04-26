import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class SuccessOutput {
  @Field()
  success: boolean;
}
