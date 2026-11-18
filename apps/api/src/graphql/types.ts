import {
  Field,
  Float,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { APPOINTMENT_STATUSES, CURRENCIES, LOCALES, ROLES } from '@clinic/shared';

export enum RoleEnum {
  patient = 'patient',
  registrar = 'registrar',
  doctor = 'doctor',
  manager = 'manager',
}
export enum StatusEnum {
  held = 'held',
  booked = 'booked',
  checked_in = 'checked_in',
  completed = 'completed',
  no_show = 'no_show',
  cancelled = 'cancelled',
}
export enum CurrencyEnum {
  UAH = 'UAH',
  PLN = 'PLN',
}
export enum LocaleEnum {
  uk = 'uk',
  en = 'en',
  pl = 'pl',
}
export enum KindEnum {
  regular = 'regular',
  waitlist_offer = 'waitlist_offer',
}
export enum OfferStatusEnum {
  pending = 'pending',
  accepted = 'accepted',
  declined = 'declined',
  expired = 'expired',
}
export enum VisitScopeEnum {
  UPCOMING = 'UPCOMING',
  PAST = 'PAST',
}
export enum BoardStateEnum {
  expected = 'expected',
  late = 'late',
  arrived = 'arrived',
  with_doctor = 'with_doctor',
  done = 'done',
  no_show = 'no_show',
  cancelled = 'cancelled',
}
export enum ExceptionKindEnum {
  vacation = 'vacation',
  sick = 'sick',
  day_off = 'day_off',
  extra_day = 'extra_day',
  custom_hours = 'custom_hours',
}
registerEnumType(RoleEnum, { name: 'Role' });
registerEnumType(StatusEnum, { name: 'AppointmentStatus' });
registerEnumType(CurrencyEnum, { name: 'Currency' });
registerEnumType(LocaleEnum, { name: 'Locale' });
registerEnumType(KindEnum, { name: 'AppointmentKind' });
registerEnumType(OfferStatusEnum, { name: 'OfferStatus' });
registerEnumType(VisitScopeEnum, { name: 'VisitScope' });
registerEnumType(BoardStateEnum, { name: 'BoardState' });
registerEnumType(ExceptionKindEnum, { name: 'ExceptionKind' });
// keep the GraphQL enums honest against the shared constants
void [APPOINTMENT_STATUSES, CURRENCIES, LOCALES, ROLES];

@ObjectType('User')
export class UserType {
  @Field(() => ID) id!: string;
  @Field(() => String) email!: string;
  @Field(() => RoleEnum) role!: RoleEnum;
  @Field(() => String, { nullable: true }) fullName?: string | null;
  @Field(() => ID, { nullable: true }) patientId?: string | null;
  @Field(() => ID, { nullable: true }) clinicId?: string | null;
  @Field(() => ID, { nullable: true }) doctorId?: string | null;
  @Field(() => LocaleEnum, { nullable: true }) locale?: LocaleEnum | null;
}

@ObjectType('Clinic')
export class ClinicType {
  @Field(() => ID) id!: string;
  @Field(() => String) city!: string;
  @Field(() => String) timeZone!: string;
  @Field(() => CurrencyEnum) currency!: CurrencyEnum;
}

@ObjectType('Service')
export class ServiceType {
  @Field(() => ID) id!: string;
  @Field(() => String) code!: string;
  @Field(() => String) specialty!: string;
  @Field(() => String) nameUk!: string;
  @Field(() => String) nameEn!: string;
  @Field(() => String) namePl!: string;
  @Field(() => Int) durationMin!: number;
  @Field(() => Boolean) needsUltrasound!: boolean;
}

@ObjectType('ClinicService')
export class ClinicServiceType {
  @Field(() => ServiceType) service!: ServiceType;
  /** Minor units (kopiyky / grosze) in the clinic currency. */
  @Field(() => Int) priceMinor!: number;
  @Field(() => CurrencyEnum) currency!: CurrencyEnum;
}

@ObjectType('Doctor')
export class DoctorType {
  @Field(() => ID) id!: string;
  @Field(() => String) fullName!: string;
  @Field(() => String) specialty!: string;
}

@ObjectType('Slot')
export class SlotType {
  @Field(() => ID) doctorId!: string;
  @Field(() => GraphQLISODateTime) startsAt!: Date;
  @Field(() => GraphQLISODateTime) endsAt!: Date;
  /** Clinic-local calendar date, e.g. 2026-06-10. */
  @Field(() => String) localDate!: string;
  /** Clinic-local wall-clock time, e.g. 09:15. Display this, never the browser's conversion. */
  @Field(() => String) localTime!: string;
  @Field(() => DoctorType, { nullable: true }) doctor?: DoctorType | null;
}

@ObjectType('Availability')
export class AvailabilityType {
  @Field(() => ID) clinicId!: string;
  @Field(() => String) timeZone!: string;
  @Field(() => CurrencyEnum) currency!: CurrencyEnum;
  @Field(() => Int) durationMin!: number;
  @Field(() => Int) priceMinor!: number;
  @Field(() => [DoctorType]) doctors!: DoctorType[];
  @Field(() => [SlotType]) slots!: SlotType[];
}

@ObjectType('Patient')
export class PatientType {
  @Field(() => ID) id!: string;
  @Field(() => String) fullName!: string;
  @Field(() => String, { nullable: true }) phone?: string | null;
  @Field(() => String, { nullable: true }) email?: string | null;
  @Field(() => GraphQLISODateTime, { nullable: true }) onlineBookingBlockedUntil?: Date | null;
  /** This patient's visits that the caller may see (own for patients, the clinic's for registrars, the doctor's own for doctors). */
  @Field(() => [AppointmentType]) visits!: AppointmentType[];
}

@ObjectType('AppointmentEvent')
export class AppointmentEventType {
  @Field(() => GraphQLISODateTime) at!: Date;
  @Field(() => String) type!: string;
  @Field(() => StatusEnum, { nullable: true }) fromStatus?: StatusEnum | null;
  @Field(() => StatusEnum) toStatus!: StatusEnum;
  @Field(() => String) actorRole!: string;
  @Field(() => Boolean) late!: boolean;
  @Field(() => String, { nullable: true }) reason?: string | null;
  @Field(() => GraphQLISODateTime, { nullable: true }) oldStartsAt?: Date | null;
  @Field(() => GraphQLISODateTime, { nullable: true }) newStartsAt?: Date | null;
}

@ObjectType('Appointment')
export class AppointmentType {
  @Field(() => ID) id!: string;
  @Field(() => StatusEnum) status!: StatusEnum;
  @Field(() => KindEnum) kind!: KindEnum;
  @Field(() => GraphQLISODateTime) startsAt!: Date;
  @Field(() => GraphQLISODateTime) endsAt!: Date;
  @Field(() => String) localDate!: string;
  @Field(() => GraphQLISODateTime, { nullable: true }) holdExpiresAt?: Date | null;
  @Field(() => Int) priceMinor!: number;
  @Field(() => CurrencyEnum) currency!: CurrencyEnum;
  @Field(() => Int) version!: number;
  @Field(() => Boolean) cancelledLate!: boolean;
  @Field(() => GraphQLISODateTime) createdAt!: Date;
  @Field(() => BoardStateEnum) boardState!: BoardStateEnum;
  @Field(() => ID) doctorId!: string;
  @Field(() => ID) clinicId!: string;
  @Field(() => ID) serviceId!: string;
  @Field(() => ID) patientId!: string;
  @Field(() => DoctorType) doctor!: DoctorType;
  @Field(() => ClinicType) clinic!: ClinicType;
  @Field(() => ServiceType) service!: ServiceType;
  @Field(() => PatientType, { nullable: true }) patient?: PatientType | null;
  @Field(() => [AppointmentEventType]) events!: AppointmentEventType[];
}

@ObjectType('WaitlistEntry')
export class WaitlistEntryType {
  @Field(() => ID) id!: string;
  @Field(() => ID) doctorId!: string;
  @Field(() => ID) serviceId!: string;
  @Field(() => String) fromDate!: string;
  @Field(() => String) toDate!: string;
  @Field(() => Int) priority!: number;
  @Field(() => String) status!: string;
  @Field(() => GraphQLISODateTime) createdAt!: Date;
  @Field(() => DoctorType) doctor!: DoctorType;
  @Field(() => ServiceType) service!: ServiceType;
}

@ObjectType('WaitlistOffer')
export class WaitlistOfferType {
  @Field(() => ID) id!: string;
  @Field(() => OfferStatusEnum) status!: OfferStatusEnum;
  @Field(() => GraphQLISODateTime) expiresAt!: Date;
  @Field(() => ID) appointmentId!: string;
  @Field(() => AppointmentType, { nullable: true }) appointment?: AppointmentType | null;
}

@ObjectType('Notification')
export class NotificationType {
  @Field(() => ID) id!: string;
  @Field(() => String) kind!: string;
  @Field(() => GraphQLISODateTime) createdAt!: Date;
  @Field(() => GraphQLISODateTime, { nullable: true }) readAt?: Date | null;
  @Field(() => String) payloadJson!: string;
}

@ObjectType('AvailabilityEvent')
export class AvailabilityEventType {
  @Field(() => ID) clinicId!: string;
  @Field(() => ID) doctorId!: string;
  @Field(() => String) localDate!: string;
}

@ObjectType('TemplateRow')
export class TemplateRowType {
  @Field(() => ID) doctorId!: string;
  @Field(() => ID) clinicId!: string;
  @Field(() => Int) weekday!: number;
  @Field(() => String) startLocal!: string;
  @Field(() => String) endLocal!: string;
  @Field(() => String, { nullable: true }) breakStartLocal?: string | null;
  @Field(() => String, { nullable: true }) breakEndLocal?: string | null;
}

@ObjectType('ExceptionRow')
export class ExceptionRowType {
  @Field(() => ID) doctorId!: string;
  @Field(() => String) localDate!: string;
  @Field(() => ExceptionKindEnum) kind!: ExceptionKindEnum;
  @Field(() => ID, { nullable: true }) clinicId?: string | null;
  @Field(() => String, { nullable: true }) startLocal?: string | null;
  @Field(() => String, { nullable: true }) endLocal?: string | null;
}

@ObjectType('DoctorSchedule')
export class DoctorScheduleType {
  @Field(() => ID) doctorId!: string;
  @Field(() => [TemplateRowType]) templates!: TemplateRowType[];
  @Field(() => [ExceptionRowType]) exceptions!: ExceptionRowType[];
}

@ObjectType('SickResult')
export class SickResultType {
  @Field(() => Int) cancelled!: number;
  @Field(() => Boolean) alreadyMarked!: boolean;
}

@ObjectType('UtilizationRow')
export class UtilizationRowType {
  @Field(() => ID) doctorId!: string;
  @Field(() => String) doctorName!: string;
  @Field(() => ID) clinicId!: string;
  @Field(() => Int) workMinutes!: number;
  @Field(() => Int) bookedMinutes!: number;
  @Field(() => Float) percent!: number;
}

@ObjectType('RateStats')
export class RateStatsType {
  @Field(() => Int) bookings!: number;
  @Field(() => Int) noShows!: number;
  @Field(() => Int) lateCancels!: number;
  @Field(() => Float) noShowPercent!: number;
  @Field(() => Float) lateCancelPercent!: number;
}

@ObjectType('WaitlistStats')
export class WaitlistStatsType {
  @Field(() => Int) offered!: number;
  @Field(() => Int) accepted!: number;
  @Field(() => Float) acceptedPercent!: number;
}

@ObjectType('RevenueRow')
export class RevenueRowType {
  @Field(() => ID) serviceId!: string;
  @Field(() => String) serviceCode!: string;
  @Field(() => String) nameUk!: string;
  @Field(() => String) nameEn!: string;
  @Field(() => String) namePl!: string;
  @Field(() => CurrencyEnum) currency!: CurrencyEnum;
  @Field(() => Float) revenueMinor!: number;
  @Field(() => Int) visits!: number;
}

@ObjectType('Report')
export class ReportType {
  @Field(() => String) from!: string;
  @Field(() => String) to!: string;
  @Field(() => [UtilizationRowType]) utilization!: UtilizationRowType[];
  @Field(() => RateStatsType) rates!: RateStatsType;
  @Field(() => WaitlistStatsType) waitlist!: WaitlistStatsType;
  @Field(() => [RevenueRowType]) revenue!: RevenueRowType[];
}
