import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'isCustomDate', async: false })
export class IsCustomDateConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    if (!value) {
      return true;
    }
    return !isNaN(Number(new Date(value)));
  }

  defaultMessage(args: ValidationArguments) {
    return `Field "${args.property}" must be a Date`;
  }
}
