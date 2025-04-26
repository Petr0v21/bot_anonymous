import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class PaginationOutput {
  @Field()
  totalPages?: number;
}
