import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { ExceptionKindEnum, LocaleEnum } from './types.js';

// Inputs are validated with the shared Zod schemas in the resolvers (one source of truth for api
// and web); these classes only describe the wire shape.

@InputType()
export class SignUpInput {
  @Field(() => String) email!: string;
  @Field(() => String) password!: string;
  @Field(() => String) fullName!: string;
  @Field(() => String) phone!: string;
  @Field(() => LocaleEnum, { nullable: true }) locale?: LocaleEnum | null;
}
@InputType()
export class SignInInput {
  @Field(() => String) email!: string;
  @Field(() => String) password!: string;
}
@InputType()
export class AvailabilityInput {
  @Field(() => ID) clinicId!: string;
  @Field(() => ID) serviceId!: string;
  @Field(() => ID, { nullable: true }) doctorId?: string | null;
  @Field(() => String, { nullable: true }) fromDate?: string | null;
}
@InputType()
export class HoldSlotInput {
  @Field(() => ID) clinicId!: string;
  @Field(() => ID) doctorId!: string;
  @Field(() => ID) serviceId!: string;
  @Field(() => String) startsAt!: string;
  /** Registrar only: who the visit is for. */
  @Field(() => ID, { nullable: true }) patientId?: string | null;
}
@InputType()
export class ConfirmBookingInput {
  @Field(() => ID) appointmentId!: string;
  @Field(() => String) idempotencyKey!: string;
}
@InputType()
export class RescheduleInput {
  @Field(() => ID) appointmentId!: string;
  @Field(() => String) newStartsAt!: string;
  @Field(() => Int, { nullable: true }) expectedVersion?: number | null;
}
@InputType()
export class CancelInput {
  @Field(() => ID) appointmentId!: string;
  @Field(() => String, { nullable: true }) reason?: string | null;
}
@InputType()
export class JoinWaitlistInput {
  @Field(() => ID) doctorId!: string;
  @Field(() => ID) serviceId!: string;
  @Field(() => String) fromDate!: string;
  @Field(() => String) toDate!: string;
}
@InputType()
export class RespondOfferInput {
  @Field(() => ID) offerId!: string;
  @Field(() => String, { nullable: true }) idempotencyKey?: string | null;
}
@InputType()
export class RegistrarBookInput {
  @Field(() => ID) clinicId!: string;
  @Field(() => ID) doctorId!: string;
  @Field(() => ID) serviceId!: string;
  @Field(() => String) startsAt!: string;
  @Field(() => ID, { nullable: true }) patientId?: string | null;
  @Field(() => String, { nullable: true }) newPatientName?: string | null;
  @Field(() => String, { nullable: true }) newPatientPhone?: string | null;
  @Field(() => String, { nullable: true }) newPatientEmail?: string | null;
  @Field(() => String) idempotencyKey!: string;
}
@InputType()
export class MarkSickInput {
  @Field(() => ID) doctorId!: string;
  @Field(() => String) localDate!: string;
}
@InputType()
export class TemplateInput {
  @Field(() => ID) doctorId!: string;
  @Field(() => ID) clinicId!: string;
  @Field(() => Int) weekday!: number;
  @Field(() => String) startLocal!: string;
  @Field(() => String) endLocal!: string;
  @Field(() => String, { nullable: true }) breakStartLocal?: string | null;
  @Field(() => String, { nullable: true }) breakEndLocal?: string | null;
}
@InputType()
export class RemoveTemplateInput {
  @Field(() => ID) doctorId!: string;
  @Field(() => ID) clinicId!: string;
  @Field(() => Int) weekday!: number;
}
@InputType()
export class ExceptionInput {
  @Field(() => ID) doctorId!: string;
  @Field(() => String) localDate!: string;
  @Field(() => ExceptionKindEnum) kind!: ExceptionKindEnum;
  @Field(() => ID, { nullable: true }) clinicId?: string | null;
  @Field(() => String, { nullable: true }) startLocal?: string | null;
  @Field(() => String, { nullable: true }) endLocal?: string | null;
  @Field(() => String, { nullable: true }) breakStartLocal?: string | null;
  @Field(() => String, { nullable: true }) breakEndLocal?: string | null;
}
@InputType()
export class RemoveExceptionInput {
  @Field(() => ID) doctorId!: string;
  @Field(() => String) localDate!: string;
}
