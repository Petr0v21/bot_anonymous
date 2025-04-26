import { registerDecorator, ValidationOptions } from 'class-validator';
import { IsCustomDateConstraint } from './IsCustomDateValidator';

export function IsCustomDate(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsCustomDateConstraint,
    });
  };
}
