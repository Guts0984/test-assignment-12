/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date-time string at UTC, such as 2019-12-03T09:54:33Z, compliant with the date-time format. */
  DateTime: { input: any; output: any; }
};

export type Appointment = {
  __typename?: 'Appointment';
  boardState: BoardState;
  cancelledLate: Scalars['Boolean']['output'];
  clinic: Clinic;
  clinicId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  currency: Currency;
  doctor: Doctor;
  doctorId: Scalars['ID']['output'];
  endsAt: Scalars['DateTime']['output'];
  events: Array<AppointmentEvent>;
  holdExpiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  kind: AppointmentKind;
  localDate: Scalars['String']['output'];
  patient?: Maybe<Patient>;
  patientId: Scalars['ID']['output'];
  priceMinor: Scalars['Int']['output'];
  service: Service;
  serviceId: Scalars['ID']['output'];
  startsAt: Scalars['DateTime']['output'];
  status: AppointmentStatus;
  version: Scalars['Int']['output'];
};

export type AppointmentEvent = {
  __typename?: 'AppointmentEvent';
  actorRole: Scalars['String']['output'];
  at: Scalars['DateTime']['output'];
  fromStatus?: Maybe<AppointmentStatus>;
  late: Scalars['Boolean']['output'];
  newStartsAt?: Maybe<Scalars['DateTime']['output']>;
  oldStartsAt?: Maybe<Scalars['DateTime']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  toStatus: AppointmentStatus;
  type: Scalars['String']['output'];
};

export type AppointmentKind =
  | 'regular'
  | 'waitlist_offer';

export type AppointmentStatus =
  | 'booked'
  | 'cancelled'
  | 'checked_in'
  | 'completed'
  | 'held'
  | 'no_show';

export type Availability = {
  __typename?: 'Availability';
  clinicId: Scalars['ID']['output'];
  currency: Currency;
  doctors: Array<Doctor>;
  durationMin: Scalars['Int']['output'];
  priceMinor: Scalars['Int']['output'];
  slots: Array<Slot>;
  timeZone: Scalars['String']['output'];
};

export type AvailabilityEvent = {
  __typename?: 'AvailabilityEvent';
  clinicId: Scalars['ID']['output'];
  doctorId: Scalars['ID']['output'];
  localDate: Scalars['String']['output'];
};

export type AvailabilityInput = {
  clinicId: Scalars['ID']['input'];
  doctorId?: InputMaybe<Scalars['ID']['input']>;
  fromDate?: InputMaybe<Scalars['String']['input']>;
  serviceId: Scalars['ID']['input'];
};

export type BoardState =
  | 'arrived'
  | 'cancelled'
  | 'done'
  | 'expected'
  | 'late'
  | 'no_show'
  | 'with_doctor';

export type CancelInput = {
  appointmentId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};

export type Clinic = {
  __typename?: 'Clinic';
  city: Scalars['String']['output'];
  currency: Currency;
  id: Scalars['ID']['output'];
  timeZone: Scalars['String']['output'];
};

export type ClinicService = {
  __typename?: 'ClinicService';
  currency: Currency;
  priceMinor: Scalars['Int']['output'];
  service: Service;
};

export type ConfirmBookingInput = {
  appointmentId: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
};

export type Currency =
  | 'PLN'
  | 'UAH';

export type Doctor = {
  __typename?: 'Doctor';
  fullName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  specialty: Scalars['String']['output'];
};

export type DoctorSchedule = {
  __typename?: 'DoctorSchedule';
  doctorId: Scalars['ID']['output'];
  exceptions: Array<ExceptionRow>;
  templates: Array<TemplateRow>;
};

export type ExceptionInput = {
  breakEndLocal?: InputMaybe<Scalars['String']['input']>;
  breakStartLocal?: InputMaybe<Scalars['String']['input']>;
  clinicId?: InputMaybe<Scalars['ID']['input']>;
  doctorId: Scalars['ID']['input'];
  endLocal?: InputMaybe<Scalars['String']['input']>;
  kind: ExceptionKind;
  localDate: Scalars['String']['input'];
  startLocal?: InputMaybe<Scalars['String']['input']>;
};

export type ExceptionKind =
  | 'custom_hours'
  | 'day_off'
  | 'extra_day'
  | 'sick'
  | 'vacation';

export type ExceptionRow = {
  __typename?: 'ExceptionRow';
  clinicId?: Maybe<Scalars['ID']['output']>;
  doctorId: Scalars['ID']['output'];
  endLocal?: Maybe<Scalars['String']['output']>;
  kind: ExceptionKind;
  localDate: Scalars['String']['output'];
  startLocal?: Maybe<Scalars['String']['output']>;
};

export type HoldSlotInput = {
  clinicId: Scalars['ID']['input'];
  doctorId: Scalars['ID']['input'];
  patientId?: InputMaybe<Scalars['ID']['input']>;
  serviceId: Scalars['ID']['input'];
  startsAt: Scalars['String']['input'];
};

export type JoinWaitlistInput = {
  doctorId: Scalars['ID']['input'];
  fromDate: Scalars['String']['input'];
  serviceId: Scalars['ID']['input'];
  toDate: Scalars['String']['input'];
};

export type Locale =
  | 'en'
  | 'pl'
  | 'uk';

export type MarkSickInput = {
  doctorId: Scalars['ID']['input'];
  localDate: Scalars['String']['input'];
};

export type Mutation = {
  __typename?: 'Mutation';
  acceptOffer: Appointment;
  cancelAppointment: Appointment;
  checkIn: Appointment;
  completeVisit: Appointment;
  confirmBooking: Appointment;
  declineOffer: Scalars['Boolean']['output'];
  holdSlot: Appointment;
  joinWaitlist: WaitlistEntry;
  leaveWaitlist: Scalars['Boolean']['output'];
  markDoctorSick: SickResult;
  markNoShow: Appointment;
  markNotificationsRead: Scalars['Int']['output'];
  registrarBook: Appointment;
  removeScheduleException: Scalars['Boolean']['output'];
  removeScheduleTemplate: Scalars['Boolean']['output'];
  rescheduleAppointment: Appointment;
  setScheduleException: Scalars['Boolean']['output'];
  setScheduleTemplate: Scalars['Boolean']['output'];
  signIn: User;
  signOut: Scalars['Boolean']['output'];
  signUp: User;
};


export type MutationAcceptOfferArgs = {
  input: RespondOfferInput;
};


export type MutationCancelAppointmentArgs = {
  input: CancelInput;
};


export type MutationCheckInArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCompleteVisitArgs = {
  id: Scalars['ID']['input'];
};


export type MutationConfirmBookingArgs = {
  input: ConfirmBookingInput;
};


export type MutationDeclineOfferArgs = {
  id: Scalars['ID']['input'];
};


export type MutationHoldSlotArgs = {
  input: HoldSlotInput;
};


export type MutationJoinWaitlistArgs = {
  input: JoinWaitlistInput;
};


export type MutationLeaveWaitlistArgs = {
  id: Scalars['ID']['input'];
};


export type MutationMarkDoctorSickArgs = {
  input: MarkSickInput;
};


export type MutationMarkNoShowArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRegistrarBookArgs = {
  input: RegistrarBookInput;
};


export type MutationRemoveScheduleExceptionArgs = {
  input: RemoveExceptionInput;
};


export type MutationRemoveScheduleTemplateArgs = {
  input: RemoveTemplateInput;
};


export type MutationRescheduleAppointmentArgs = {
  input: RescheduleInput;
};


export type MutationSetScheduleExceptionArgs = {
  input: ExceptionInput;
};


export type MutationSetScheduleTemplateArgs = {
  input: TemplateInput;
};


export type MutationSignInArgs = {
  input: SignInInput;
};


export type MutationSignUpArgs = {
  input: SignUpInput;
};

export type Notification = {
  __typename?: 'Notification';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  payloadJson: Scalars['String']['output'];
  readAt?: Maybe<Scalars['DateTime']['output']>;
};

export type OfferStatus =
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'pending';

export type Patient = {
  __typename?: 'Patient';
  email?: Maybe<Scalars['String']['output']>;
  fullName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  onlineBookingBlockedUntil?: Maybe<Scalars['DateTime']['output']>;
  phone?: Maybe<Scalars['String']['output']>;
  visits: Array<Appointment>;
};

export type Query = {
  __typename?: 'Query';
  appointment?: Maybe<Appointment>;
  availability: Availability;
  clinicBoard: Array<Appointment>;
  clinicDoctors: Array<Doctor>;
  clinicServices: Array<ClinicService>;
  clinics: Array<Clinic>;
  doctorSchedule: Array<Appointment>;
  doctorWeeklySchedule: DoctorSchedule;
  me?: Maybe<User>;
  myAppointments: Array<Appointment>;
  myNotifications: Array<Notification>;
  myOffers: Array<WaitlistOffer>;
  myWaitlist: Array<WaitlistEntry>;
  report: Report;
  searchPatients: Array<Patient>;
};


export type QueryAppointmentArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAvailabilityArgs = {
  input: AvailabilityInput;
};


export type QueryClinicBoardArgs = {
  clinicId: Scalars['ID']['input'];
  date: Scalars['String']['input'];
};


export type QueryClinicDoctorsArgs = {
  clinicId: Scalars['ID']['input'];
  serviceId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryClinicServicesArgs = {
  clinicId: Scalars['ID']['input'];
};


export type QueryDoctorScheduleArgs = {
  days?: Scalars['Int']['input'];
  fromDate: Scalars['String']['input'];
};


export type QueryDoctorWeeklyScheduleArgs = {
  doctorId: Scalars['ID']['input'];
};


export type QueryMyAppointmentsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  scope?: VisitScope;
};


export type QueryMyNotificationsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryReportArgs = {
  clinicId?: InputMaybe<Scalars['ID']['input']>;
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type QuerySearchPatientsArgs = {
  query: Scalars['String']['input'];
};

export type RateStats = {
  __typename?: 'RateStats';
  bookings: Scalars['Int']['output'];
  lateCancelPercent: Scalars['Float']['output'];
  lateCancels: Scalars['Int']['output'];
  noShowPercent: Scalars['Float']['output'];
  noShows: Scalars['Int']['output'];
};

export type RegistrarBookInput = {
  clinicId: Scalars['ID']['input'];
  doctorId: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
  newPatientEmail?: InputMaybe<Scalars['String']['input']>;
  newPatientName?: InputMaybe<Scalars['String']['input']>;
  newPatientPhone?: InputMaybe<Scalars['String']['input']>;
  patientId?: InputMaybe<Scalars['ID']['input']>;
  serviceId: Scalars['ID']['input'];
  startsAt: Scalars['String']['input'];
};

export type RemoveExceptionInput = {
  doctorId: Scalars['ID']['input'];
  localDate: Scalars['String']['input'];
};

export type RemoveTemplateInput = {
  clinicId: Scalars['ID']['input'];
  doctorId: Scalars['ID']['input'];
  weekday: Scalars['Int']['input'];
};

export type Report = {
  __typename?: 'Report';
  from: Scalars['String']['output'];
  rates: RateStats;
  revenue: Array<RevenueRow>;
  to: Scalars['String']['output'];
  utilization: Array<UtilizationRow>;
  waitlist: WaitlistStats;
};

export type RescheduleInput = {
  appointmentId: Scalars['ID']['input'];
  expectedVersion?: InputMaybe<Scalars['Int']['input']>;
  newStartsAt: Scalars['String']['input'];
};

export type RespondOfferInput = {
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  offerId: Scalars['ID']['input'];
};

export type RevenueRow = {
  __typename?: 'RevenueRow';
  currency: Currency;
  nameEn: Scalars['String']['output'];
  namePl: Scalars['String']['output'];
  nameUk: Scalars['String']['output'];
  revenueMinor: Scalars['Float']['output'];
  serviceCode: Scalars['String']['output'];
  serviceId: Scalars['ID']['output'];
  visits: Scalars['Int']['output'];
};

export type Role =
  | 'doctor'
  | 'manager'
  | 'patient'
  | 'registrar';

export type Service = {
  __typename?: 'Service';
  code: Scalars['String']['output'];
  durationMin: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  nameEn: Scalars['String']['output'];
  namePl: Scalars['String']['output'];
  nameUk: Scalars['String']['output'];
  needsUltrasound: Scalars['Boolean']['output'];
  specialty: Scalars['String']['output'];
};

export type SickResult = {
  __typename?: 'SickResult';
  alreadyMarked: Scalars['Boolean']['output'];
  cancelled: Scalars['Int']['output'];
};

export type SignInInput = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};

export type SignUpInput = {
  email: Scalars['String']['input'];
  fullName: Scalars['String']['input'];
  locale?: InputMaybe<Locale>;
  password: Scalars['String']['input'];
  phone: Scalars['String']['input'];
};

export type Slot = {
  __typename?: 'Slot';
  doctor?: Maybe<Doctor>;
  doctorId: Scalars['ID']['output'];
  endsAt: Scalars['DateTime']['output'];
  localDate: Scalars['String']['output'];
  localTime: Scalars['String']['output'];
  startsAt: Scalars['DateTime']['output'];
};

export type Subscription = {
  __typename?: 'Subscription';
  availabilityChanged: AvailabilityEvent;
  clinicAppointmentChanged?: Maybe<Appointment>;
  doctorAppointmentChanged?: Maybe<Appointment>;
  myAppointmentChanged?: Maybe<Appointment>;
};


export type SubscriptionAvailabilityChangedArgs = {
  clinicId: Scalars['ID']['input'];
  doctorId?: InputMaybe<Scalars['ID']['input']>;
};


export type SubscriptionClinicAppointmentChangedArgs = {
  clinicId: Scalars['ID']['input'];
};

export type TemplateInput = {
  breakEndLocal?: InputMaybe<Scalars['String']['input']>;
  breakStartLocal?: InputMaybe<Scalars['String']['input']>;
  clinicId: Scalars['ID']['input'];
  doctorId: Scalars['ID']['input'];
  endLocal: Scalars['String']['input'];
  startLocal: Scalars['String']['input'];
  weekday: Scalars['Int']['input'];
};

export type TemplateRow = {
  __typename?: 'TemplateRow';
  breakEndLocal?: Maybe<Scalars['String']['output']>;
  breakStartLocal?: Maybe<Scalars['String']['output']>;
  clinicId: Scalars['ID']['output'];
  doctorId: Scalars['ID']['output'];
  endLocal: Scalars['String']['output'];
  startLocal: Scalars['String']['output'];
  weekday: Scalars['Int']['output'];
};

export type User = {
  __typename?: 'User';
  clinicId?: Maybe<Scalars['ID']['output']>;
  doctorId?: Maybe<Scalars['ID']['output']>;
  email: Scalars['String']['output'];
  fullName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  locale?: Maybe<Locale>;
  patientId?: Maybe<Scalars['ID']['output']>;
  role: Role;
};

export type UtilizationRow = {
  __typename?: 'UtilizationRow';
  bookedMinutes: Scalars['Int']['output'];
  clinicId: Scalars['ID']['output'];
  doctorId: Scalars['ID']['output'];
  doctorName: Scalars['String']['output'];
  percent: Scalars['Float']['output'];
  workMinutes: Scalars['Int']['output'];
};

export type VisitScope =
  | 'PAST'
  | 'UPCOMING';

export type WaitlistEntry = {
  __typename?: 'WaitlistEntry';
  createdAt: Scalars['DateTime']['output'];
  doctor: Doctor;
  doctorId: Scalars['ID']['output'];
  fromDate: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  priority: Scalars['Int']['output'];
  service: Service;
  serviceId: Scalars['ID']['output'];
  status: Scalars['String']['output'];
  toDate: Scalars['String']['output'];
};

export type WaitlistOffer = {
  __typename?: 'WaitlistOffer';
  appointment?: Maybe<Appointment>;
  appointmentId: Scalars['ID']['output'];
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  status: OfferStatus;
};

export type WaitlistStats = {
  __typename?: 'WaitlistStats';
  accepted: Scalars['Int']['output'];
  acceptedPercent: Scalars['Float']['output'];
  offered: Scalars['Int']['output'];
};

export type AppointmentFieldsFragment = { __typename?: 'Appointment', id: string, status: AppointmentStatus, kind: AppointmentKind, startsAt: any, endsAt: any, localDate: string, holdExpiresAt?: any | null, priceMinor: number, currency: Currency, version: number, cancelledLate: boolean, boardState: BoardState, doctorId: string, clinicId: string, serviceId: string, patientId: string, doctor: { __typename?: 'Doctor', id: string, fullName: string }, clinic: { __typename?: 'Clinic', id: string, city: string, timeZone: string, currency: Currency }, service: { __typename?: 'Service', id: string, nameUk: string, nameEn: string, namePl: string, durationMin: number }, patient?: { __typename?: 'Patient', id: string, fullName: string, phone?: string | null } | null };

export type AppointmentHistoryQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type AppointmentHistoryQuery = { __typename?: 'Query', appointment?: { __typename?: 'Appointment', id: string, events: Array<{ __typename?: 'AppointmentEvent', type: string, at: any, actorRole: string, late: boolean, reason?: string | null, fromStatus?: AppointmentStatus | null, toStatus: AppointmentStatus, oldStartsAt?: any | null, newStartsAt?: any | null }> } | null };

export type ClinicsQueryVariables = Exact<{ [key: string]: never; }>;


export type ClinicsQuery = { __typename?: 'Query', clinics: Array<{ __typename?: 'Clinic', id: string, city: string, timeZone: string, currency: Currency }> };

export type ClinicServicesQueryVariables = Exact<{
  clinicId: Scalars['ID']['input'];
}>;


export type ClinicServicesQuery = { __typename?: 'Query', clinicServices: Array<{ __typename?: 'ClinicService', priceMinor: number, currency: Currency, service: { __typename?: 'Service', id: string, code: string, specialty: string, nameUk: string, nameEn: string, namePl: string, durationMin: number, needsUltrasound: boolean } }> };

export type ClinicDoctorsQueryVariables = Exact<{
  clinicId: Scalars['ID']['input'];
  serviceId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type ClinicDoctorsQuery = { __typename?: 'Query', clinicDoctors: Array<{ __typename?: 'Doctor', id: string, fullName: string, specialty: string }> };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { __typename?: 'Query', me?: { __typename?: 'User', id: string, role: Role, email: string, fullName?: string | null, patientId?: string | null, clinicId?: string | null, doctorId?: string | null, locale?: Locale | null } | null };

export type SignOutMutationVariables = Exact<{ [key: string]: never; }>;


export type SignOutMutation = { __typename?: 'Mutation', signOut: boolean };

export type AvailabilityQueryVariables = Exact<{
  input: AvailabilityInput;
}>;


export type AvailabilityQuery = { __typename?: 'Query', availability: { __typename?: 'Availability', clinicId: string, timeZone: string, currency: Currency, durationMin: number, priceMinor: number, doctors: Array<{ __typename?: 'Doctor', id: string, fullName: string, specialty: string }>, slots: Array<{ __typename?: 'Slot', doctorId: string, startsAt: any, endsAt: any, localDate: string, localTime: string }> } };

export type AvailabilityChangedSubscriptionVariables = Exact<{
  clinicId: Scalars['ID']['input'];
  doctorId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type AvailabilityChangedSubscription = { __typename?: 'Subscription', availabilityChanged: { __typename?: 'AvailabilityEvent', clinicId: string, doctorId: string, localDate: string } };

export type CheckInMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type CheckInMutation = { __typename?: 'Mutation', checkIn: { __typename?: 'Appointment', id: string, status: AppointmentStatus, boardState: BoardState } };

export type MarkNoShowMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type MarkNoShowMutation = { __typename?: 'Mutation', markNoShow: { __typename?: 'Appointment', id: string, status: AppointmentStatus, boardState: BoardState } };

export type CompleteVisitMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type CompleteVisitMutation = { __typename?: 'Mutation', completeVisit: { __typename?: 'Appointment', id: string, status: AppointmentStatus, boardState: BoardState } };

export type SignInMutationVariables = Exact<{
  input: SignInInput;
}>;


export type SignInMutation = { __typename?: 'Mutation', signIn: { __typename?: 'User', id: string, role: Role } };

export type SignUpMutationVariables = Exact<{
  input: SignUpInput;
}>;


export type SignUpMutation = { __typename?: 'Mutation', signUp: { __typename?: 'User', id: string, role: Role } };

export type HoldSlotMutationVariables = Exact<{
  input: HoldSlotInput;
}>;


export type HoldSlotMutation = { __typename?: 'Mutation', holdSlot: { __typename?: 'Appointment', id: string, holdExpiresAt?: any | null } };

export type ConfirmBookingMutationVariables = Exact<{
  input: ConfirmBookingInput;
}>;


export type ConfirmBookingMutation = { __typename?: 'Mutation', confirmBooking: { __typename?: 'Appointment', id: string, status: AppointmentStatus } };

export type ReleaseHoldMutationVariables = Exact<{
  input: CancelInput;
}>;


export type ReleaseHoldMutation = { __typename?: 'Mutation', cancelAppointment: { __typename?: 'Appointment', id: string, status: AppointmentStatus } };

export type HoldWatchSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type HoldWatchSubscription = { __typename?: 'Subscription', myAppointmentChanged?: { __typename?: 'Appointment', id: string, status: AppointmentStatus } | null };

export type HoldStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type HoldStatusQuery = { __typename?: 'Query', myAppointments: Array<{ __typename?: 'Appointment', id: string, status: AppointmentStatus }> };

export type CancelAppointmentMutationVariables = Exact<{
  input: CancelInput;
}>;


export type CancelAppointmentMutation = { __typename?: 'Mutation', cancelAppointment: { __typename?: 'Appointment', id: string, status: AppointmentStatus, cancelledLate: boolean } };

export type RescheduleAppointmentMutationVariables = Exact<{
  input: RescheduleInput;
}>;


export type RescheduleAppointmentMutation = { __typename?: 'Mutation', rescheduleAppointment: { __typename?: 'Appointment', id: string, startsAt: any, version: number } };

export type SearchPatientsQueryVariables = Exact<{
  query: Scalars['String']['input'];
}>;


export type SearchPatientsQuery = { __typename?: 'Query', searchPatients: Array<{ __typename?: 'Patient', id: string, fullName: string, phone?: string | null, onlineBookingBlockedUntil?: any | null }> };

export type RegistrarBookMutationVariables = Exact<{
  input: RegistrarBookInput;
}>;


export type RegistrarBookMutation = { __typename?: 'Mutation', registrarBook: { __typename?: 'Appointment', id: string, status: AppointmentStatus, startsAt: any } };

export type SetScheduleExceptionMutationVariables = Exact<{
  input: ExceptionInput;
}>;


export type SetScheduleExceptionMutation = { __typename?: 'Mutation', setScheduleException: boolean };

export type MarkDoctorSickMutationVariables = Exact<{
  input: MarkSickInput;
}>;


export type MarkDoctorSickMutation = { __typename?: 'Mutation', markDoctorSick: { __typename?: 'SickResult', cancelled: number, alreadyMarked: boolean } };

export type RemoveScheduleTemplateMutationVariables = Exact<{
  input: RemoveTemplateInput;
}>;


export type RemoveScheduleTemplateMutation = { __typename?: 'Mutation', removeScheduleTemplate: boolean };

export type RemoveScheduleExceptionMutationVariables = Exact<{
  input: RemoveExceptionInput;
}>;


export type RemoveScheduleExceptionMutation = { __typename?: 'Mutation', removeScheduleException: boolean };

export type SetScheduleTemplateMutationVariables = Exact<{
  input: TemplateInput;
}>;


export type SetScheduleTemplateMutation = { __typename?: 'Mutation', setScheduleTemplate: boolean };

export type JoinWaitlistMutationVariables = Exact<{
  input: JoinWaitlistInput;
}>;


export type JoinWaitlistMutation = { __typename?: 'Mutation', joinWaitlist: { __typename?: 'WaitlistEntry', id: string, fromDate: string, toDate: string } };

export type MyWaitlistQueryVariables = Exact<{ [key: string]: never; }>;


export type MyWaitlistQuery = { __typename?: 'Query', myWaitlist: Array<{ __typename?: 'WaitlistEntry', id: string, fromDate: string, toDate: string, priority: number, doctor: { __typename?: 'Doctor', fullName: string }, service: { __typename?: 'Service', nameUk: string, nameEn: string, namePl: string } }> };

export type LeaveWaitlistMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type LeaveWaitlistMutation = { __typename?: 'Mutation', leaveWaitlist: boolean };

export type MyOffersQueryVariables = Exact<{ [key: string]: never; }>;


export type MyOffersQuery = { __typename?: 'Query', myOffers: Array<{ __typename?: 'WaitlistOffer', id: string, expiresAt: any, appointment?: { __typename?: 'Appointment', id: string, startsAt: any, clinic: { __typename?: 'Clinic', timeZone: string }, doctor: { __typename?: 'Doctor', fullName: string } } | null }> };

export type OfferWatchSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type OfferWatchSubscription = { __typename?: 'Subscription', myAppointmentChanged?: { __typename?: 'Appointment', id: string, status: AppointmentStatus } | null };

export type AcceptOfferMutationVariables = Exact<{
  input: RespondOfferInput;
}>;


export type AcceptOfferMutation = { __typename?: 'Mutation', acceptOffer: { __typename?: 'Appointment', id: string, status: AppointmentStatus } };

export type DeclineOfferMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeclineOfferMutation = { __typename?: 'Mutation', declineOffer: boolean };

export type MyNotificationsQueryVariables = Exact<{ [key: string]: never; }>;


export type MyNotificationsQuery = { __typename?: 'Query', myNotifications: Array<{ __typename?: 'Notification', id: string, kind: string, createdAt: any, readAt?: any | null }> };

export type DoctorWeekQueryVariables = Exact<{
  from: Scalars['String']['input'];
}>;


export type DoctorWeekQuery = { __typename?: 'Query', doctorSchedule: Array<{ __typename?: 'Appointment', id: string, status: AppointmentStatus, kind: AppointmentKind, startsAt: any, endsAt: any, localDate: string, holdExpiresAt?: any | null, priceMinor: number, currency: Currency, version: number, cancelledLate: boolean, boardState: BoardState, doctorId: string, clinicId: string, serviceId: string, patientId: string, doctor: { __typename?: 'Doctor', id: string, fullName: string }, clinic: { __typename?: 'Clinic', id: string, city: string, timeZone: string, currency: Currency }, service: { __typename?: 'Service', id: string, nameUk: string, nameEn: string, namePl: string, durationMin: number }, patient?: { __typename?: 'Patient', id: string, fullName: string, phone?: string | null } | null }> };

export type DoctorChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type DoctorChangedSubscription = { __typename?: 'Subscription', doctorAppointmentChanged?: { __typename?: 'Appointment', id: string, status: AppointmentStatus } | null };

export type MyAppointmentsQueryVariables = Exact<{
  scope: VisitScope;
}>;


export type MyAppointmentsQuery = { __typename?: 'Query', myAppointments: Array<{ __typename?: 'Appointment', id: string, status: AppointmentStatus, kind: AppointmentKind, startsAt: any, endsAt: any, localDate: string, holdExpiresAt?: any | null, priceMinor: number, currency: Currency, version: number, cancelledLate: boolean, boardState: BoardState, doctorId: string, clinicId: string, serviceId: string, patientId: string, doctor: { __typename?: 'Doctor', id: string, fullName: string }, clinic: { __typename?: 'Clinic', id: string, city: string, timeZone: string, currency: Currency }, service: { __typename?: 'Service', id: string, nameUk: string, nameEn: string, namePl: string, durationMin: number }, patient?: { __typename?: 'Patient', id: string, fullName: string, phone?: string | null } | null }> };

export type MyAppointmentsChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MyAppointmentsChangedSubscription = { __typename?: 'Subscription', myAppointmentChanged?: { __typename?: 'Appointment', id: string, status: AppointmentStatus } | null };

export type ClinicBoardQueryVariables = Exact<{
  clinicId: Scalars['ID']['input'];
  date: Scalars['String']['input'];
}>;


export type ClinicBoardQuery = { __typename?: 'Query', clinicBoard: Array<{ __typename?: 'Appointment', id: string, status: AppointmentStatus, kind: AppointmentKind, startsAt: any, endsAt: any, localDate: string, holdExpiresAt?: any | null, priceMinor: number, currency: Currency, version: number, cancelledLate: boolean, boardState: BoardState, doctorId: string, clinicId: string, serviceId: string, patientId: string, doctor: { __typename?: 'Doctor', id: string, fullName: string }, clinic: { __typename?: 'Clinic', id: string, city: string, timeZone: string, currency: Currency }, service: { __typename?: 'Service', id: string, nameUk: string, nameEn: string, namePl: string, durationMin: number }, patient?: { __typename?: 'Patient', id: string, fullName: string, phone?: string | null } | null }> };

export type BoardChangedSubscriptionVariables = Exact<{
  clinicId: Scalars['ID']['input'];
}>;


export type BoardChangedSubscription = { __typename?: 'Subscription', clinicAppointmentChanged?: { __typename?: 'Appointment', id: string, status: AppointmentStatus } | null };

export type ReportQueryVariables = Exact<{
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
  clinicId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type ReportQuery = { __typename?: 'Query', report: { __typename?: 'Report', from: string, to: string, utilization: Array<{ __typename?: 'UtilizationRow', doctorId: string, doctorName: string, clinicId: string, workMinutes: number, bookedMinutes: number, percent: number }>, rates: { __typename?: 'RateStats', bookings: number, noShows: number, lateCancels: number, noShowPercent: number, lateCancelPercent: number }, waitlist: { __typename?: 'WaitlistStats', offered: number, accepted: number, acceptedPercent: number }, revenue: Array<{ __typename?: 'RevenueRow', serviceId: string, serviceCode: string, nameUk: string, nameEn: string, namePl: string, currency: Currency, revenueMinor: number, visits: number }> } };

export type DoctorWeeklyScheduleQueryVariables = Exact<{
  doctorId: Scalars['ID']['input'];
}>;


export type DoctorWeeklyScheduleQuery = { __typename?: 'Query', doctorWeeklySchedule: { __typename?: 'DoctorSchedule', doctorId: string, templates: Array<{ __typename?: 'TemplateRow', doctorId: string, clinicId: string, weekday: number, startLocal: string, endLocal: string, breakStartLocal?: string | null, breakEndLocal?: string | null }>, exceptions: Array<{ __typename?: 'ExceptionRow', doctorId: string, localDate: string, kind: ExceptionKind, clinicId?: string | null, startLocal?: string | null, endLocal?: string | null }> } };

export const AppointmentFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AppointmentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Appointment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"localDate"}},{"kind":"Field","name":{"kind":"Name","value":"holdExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"priceMinor"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"cancelledLate"}},{"kind":"Field","name":{"kind":"Name","value":"boardState"}},{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"serviceId"}},{"kind":"Field","name":{"kind":"Name","value":"patientId"}},{"kind":"Field","name":{"kind":"Name","value":"doctor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"clinic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"timeZone"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}}]}},{"kind":"Field","name":{"kind":"Name","value":"service"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"nameUk"}},{"kind":"Field","name":{"kind":"Name","value":"nameEn"}},{"kind":"Field","name":{"kind":"Name","value":"namePl"}},{"kind":"Field","name":{"kind":"Name","value":"durationMin"}}]}},{"kind":"Field","name":{"kind":"Name","value":"patient"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}}]}}]}}]} as unknown as DocumentNode<AppointmentFieldsFragment, unknown>;
export const AppointmentHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AppointmentHistory"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appointment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"events"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"at"}},{"kind":"Field","name":{"kind":"Name","value":"actorRole"}},{"kind":"Field","name":{"kind":"Name","value":"late"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"fromStatus"}},{"kind":"Field","name":{"kind":"Name","value":"toStatus"}},{"kind":"Field","name":{"kind":"Name","value":"oldStartsAt"}},{"kind":"Field","name":{"kind":"Name","value":"newStartsAt"}}]}}]}}]}}]} as unknown as DocumentNode<AppointmentHistoryQuery, AppointmentHistoryQueryVariables>;
export const ClinicsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Clinics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clinics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"timeZone"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}}]}}]}}]} as unknown as DocumentNode<ClinicsQuery, ClinicsQueryVariables>;
export const ClinicServicesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ClinicServices"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clinicServices"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"clinicId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"priceMinor"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"service"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"code"}},{"kind":"Field","name":{"kind":"Name","value":"specialty"}},{"kind":"Field","name":{"kind":"Name","value":"nameUk"}},{"kind":"Field","name":{"kind":"Name","value":"nameEn"}},{"kind":"Field","name":{"kind":"Name","value":"namePl"}},{"kind":"Field","name":{"kind":"Name","value":"durationMin"}},{"kind":"Field","name":{"kind":"Name","value":"needsUltrasound"}}]}}]}}]}}]} as unknown as DocumentNode<ClinicServicesQuery, ClinicServicesQueryVariables>;
export const ClinicDoctorsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ClinicDoctors"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"serviceId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clinicDoctors"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"clinicId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}}},{"kind":"Argument","name":{"kind":"Name","value":"serviceId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"serviceId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"specialty"}}]}}]}}]} as unknown as DocumentNode<ClinicDoctorsQuery, ClinicDoctorsQueryVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"patientId"}},{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"locale"}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const SignOutDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SignOut"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"signOut"}}]}}]} as unknown as DocumentNode<SignOutMutation, SignOutMutationVariables>;
export const AvailabilityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Availability"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AvailabilityInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"availability"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"timeZone"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"durationMin"}},{"kind":"Field","name":{"kind":"Name","value":"priceMinor"}},{"kind":"Field","name":{"kind":"Name","value":"doctors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"specialty"}}]}},{"kind":"Field","name":{"kind":"Name","value":"slots"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"localDate"}},{"kind":"Field","name":{"kind":"Name","value":"localTime"}}]}}]}}]}}]} as unknown as DocumentNode<AvailabilityQuery, AvailabilityQueryVariables>;
export const AvailabilityChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"AvailabilityChanged"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"doctorId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"availabilityChanged"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"clinicId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}}},{"kind":"Argument","name":{"kind":"Name","value":"doctorId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"doctorId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"localDate"}}]}}]}}]} as unknown as DocumentNode<AvailabilityChangedSubscription, AvailabilityChangedSubscriptionVariables>;
export const CheckInDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CheckIn"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"checkIn"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"boardState"}}]}}]}}]} as unknown as DocumentNode<CheckInMutation, CheckInMutationVariables>;
export const MarkNoShowDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkNoShow"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markNoShow"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"boardState"}}]}}]}}]} as unknown as DocumentNode<MarkNoShowMutation, MarkNoShowMutationVariables>;
export const CompleteVisitDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CompleteVisit"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"completeVisit"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"boardState"}}]}}]}}]} as unknown as DocumentNode<CompleteVisitMutation, CompleteVisitMutationVariables>;
export const SignInDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SignIn"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SignInInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"signIn"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}}]}}]} as unknown as DocumentNode<SignInMutation, SignInMutationVariables>;
export const SignUpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SignUp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SignUpInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"signUp"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}}]}}]} as unknown as DocumentNode<SignUpMutation, SignUpMutationVariables>;
export const HoldSlotDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"HoldSlot"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HoldSlotInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"holdSlot"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"holdExpiresAt"}}]}}]}}]} as unknown as DocumentNode<HoldSlotMutation, HoldSlotMutationVariables>;
export const ConfirmBookingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ConfirmBooking"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ConfirmBookingInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"confirmBooking"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<ConfirmBookingMutation, ConfirmBookingMutationVariables>;
export const ReleaseHoldDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ReleaseHold"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CancelInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelAppointment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<ReleaseHoldMutation, ReleaseHoldMutationVariables>;
export const HoldWatchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"HoldWatch"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myAppointmentChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<HoldWatchSubscription, HoldWatchSubscriptionVariables>;
export const HoldStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"HoldStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myAppointments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"scope"},"value":{"kind":"EnumValue","value":"UPCOMING"}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"30"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<HoldStatusQuery, HoldStatusQueryVariables>;
export const CancelAppointmentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CancelAppointment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CancelInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelAppointment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"cancelledLate"}}]}}]}}]} as unknown as DocumentNode<CancelAppointmentMutation, CancelAppointmentMutationVariables>;
export const RescheduleAppointmentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RescheduleAppointment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RescheduleInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rescheduleAppointment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"version"}}]}}]}}]} as unknown as DocumentNode<RescheduleAppointmentMutation, RescheduleAppointmentMutationVariables>;
export const SearchPatientsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SearchPatients"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"query"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"searchPatients"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"query"},"value":{"kind":"Variable","name":{"kind":"Name","value":"query"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"onlineBookingBlockedUntil"}}]}}]}}]} as unknown as DocumentNode<SearchPatientsQuery, SearchPatientsQueryVariables>;
export const RegistrarBookDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegistrarBook"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RegistrarBookInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registrarBook"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}}]}}]}}]} as unknown as DocumentNode<RegistrarBookMutation, RegistrarBookMutationVariables>;
export const SetScheduleExceptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetScheduleException"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ExceptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setScheduleException"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<SetScheduleExceptionMutation, SetScheduleExceptionMutationVariables>;
export const MarkDoctorSickDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkDoctorSick"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MarkSickInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markDoctorSick"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelled"}},{"kind":"Field","name":{"kind":"Name","value":"alreadyMarked"}}]}}]}}]} as unknown as DocumentNode<MarkDoctorSickMutation, MarkDoctorSickMutationVariables>;
export const RemoveScheduleTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveScheduleTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RemoveTemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeScheduleTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<RemoveScheduleTemplateMutation, RemoveScheduleTemplateMutationVariables>;
export const RemoveScheduleExceptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveScheduleException"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RemoveExceptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeScheduleException"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<RemoveScheduleExceptionMutation, RemoveScheduleExceptionMutationVariables>;
export const SetScheduleTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetScheduleTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"TemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setScheduleTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<SetScheduleTemplateMutation, SetScheduleTemplateMutationVariables>;
export const JoinWaitlistDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"JoinWaitlist"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JoinWaitlistInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"joinWaitlist"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fromDate"}},{"kind":"Field","name":{"kind":"Name","value":"toDate"}}]}}]}}]} as unknown as DocumentNode<JoinWaitlistMutation, JoinWaitlistMutationVariables>;
export const MyWaitlistDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyWaitlist"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myWaitlist"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fromDate"}},{"kind":"Field","name":{"kind":"Name","value":"toDate"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"doctor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"service"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nameUk"}},{"kind":"Field","name":{"kind":"Name","value":"nameEn"}},{"kind":"Field","name":{"kind":"Name","value":"namePl"}}]}}]}}]}}]} as unknown as DocumentNode<MyWaitlistQuery, MyWaitlistQueryVariables>;
export const LeaveWaitlistDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LeaveWaitlist"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"leaveWaitlist"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<LeaveWaitlistMutation, LeaveWaitlistMutationVariables>;
export const MyOffersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyOffers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myOffers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"appointment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"clinic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timeZone"}}]}},{"kind":"Field","name":{"kind":"Name","value":"doctor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MyOffersQuery, MyOffersQueryVariables>;
export const OfferWatchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OfferWatch"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myAppointmentChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<OfferWatchSubscription, OfferWatchSubscriptionVariables>;
export const AcceptOfferDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AcceptOffer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RespondOfferInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"acceptOffer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<AcceptOfferMutation, AcceptOfferMutationVariables>;
export const DeclineOfferDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeclineOffer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"declineOffer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeclineOfferMutation, DeclineOfferMutationVariables>;
export const MyNotificationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyNotifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myNotifications"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"10"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}}]}}]}}]} as unknown as DocumentNode<MyNotificationsQuery, MyNotificationsQueryVariables>;
export const DoctorWeekDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DoctorWeek"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"from"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"doctorSchedule"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"fromDate"},"value":{"kind":"Variable","name":{"kind":"Name","value":"from"}}},{"kind":"Argument","name":{"kind":"Name","value":"days"},"value":{"kind":"IntValue","value":"7"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AppointmentFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AppointmentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Appointment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"localDate"}},{"kind":"Field","name":{"kind":"Name","value":"holdExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"priceMinor"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"cancelledLate"}},{"kind":"Field","name":{"kind":"Name","value":"boardState"}},{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"serviceId"}},{"kind":"Field","name":{"kind":"Name","value":"patientId"}},{"kind":"Field","name":{"kind":"Name","value":"doctor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"clinic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"timeZone"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}}]}},{"kind":"Field","name":{"kind":"Name","value":"service"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"nameUk"}},{"kind":"Field","name":{"kind":"Name","value":"nameEn"}},{"kind":"Field","name":{"kind":"Name","value":"namePl"}},{"kind":"Field","name":{"kind":"Name","value":"durationMin"}}]}},{"kind":"Field","name":{"kind":"Name","value":"patient"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}}]}}]}}]} as unknown as DocumentNode<DoctorWeekQuery, DoctorWeekQueryVariables>;
export const DoctorChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"DoctorChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"doctorAppointmentChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<DoctorChangedSubscription, DoctorChangedSubscriptionVariables>;
export const MyAppointmentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyAppointments"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"scope"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"VisitScope"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myAppointments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"scope"},"value":{"kind":"Variable","name":{"kind":"Name","value":"scope"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"30"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AppointmentFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AppointmentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Appointment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"localDate"}},{"kind":"Field","name":{"kind":"Name","value":"holdExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"priceMinor"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"cancelledLate"}},{"kind":"Field","name":{"kind":"Name","value":"boardState"}},{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"serviceId"}},{"kind":"Field","name":{"kind":"Name","value":"patientId"}},{"kind":"Field","name":{"kind":"Name","value":"doctor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"clinic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"timeZone"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}}]}},{"kind":"Field","name":{"kind":"Name","value":"service"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"nameUk"}},{"kind":"Field","name":{"kind":"Name","value":"nameEn"}},{"kind":"Field","name":{"kind":"Name","value":"namePl"}},{"kind":"Field","name":{"kind":"Name","value":"durationMin"}}]}},{"kind":"Field","name":{"kind":"Name","value":"patient"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}}]}}]}}]} as unknown as DocumentNode<MyAppointmentsQuery, MyAppointmentsQueryVariables>;
export const MyAppointmentsChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MyAppointmentsChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myAppointmentChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<MyAppointmentsChangedSubscription, MyAppointmentsChangedSubscriptionVariables>;
export const ClinicBoardDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ClinicBoard"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"date"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clinicBoard"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"clinicId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}}},{"kind":"Argument","name":{"kind":"Name","value":"date"},"value":{"kind":"Variable","name":{"kind":"Name","value":"date"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AppointmentFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AppointmentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Appointment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"localDate"}},{"kind":"Field","name":{"kind":"Name","value":"holdExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"priceMinor"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"cancelledLate"}},{"kind":"Field","name":{"kind":"Name","value":"boardState"}},{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"serviceId"}},{"kind":"Field","name":{"kind":"Name","value":"patientId"}},{"kind":"Field","name":{"kind":"Name","value":"doctor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"clinic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"timeZone"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}}]}},{"kind":"Field","name":{"kind":"Name","value":"service"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"nameUk"}},{"kind":"Field","name":{"kind":"Name","value":"nameEn"}},{"kind":"Field","name":{"kind":"Name","value":"namePl"}},{"kind":"Field","name":{"kind":"Name","value":"durationMin"}}]}},{"kind":"Field","name":{"kind":"Name","value":"patient"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}}]}}]}}]} as unknown as DocumentNode<ClinicBoardQuery, ClinicBoardQueryVariables>;
export const BoardChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"BoardChanged"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clinicAppointmentChanged"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"clinicId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<BoardChangedSubscription, BoardChangedSubscriptionVariables>;
export const ReportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Report"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"from"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"to"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"report"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"from"},"value":{"kind":"Variable","name":{"kind":"Name","value":"from"}}},{"kind":"Argument","name":{"kind":"Name","value":"to"},"value":{"kind":"Variable","name":{"kind":"Name","value":"to"}}},{"kind":"Argument","name":{"kind":"Name","value":"clinicId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clinicId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"from"}},{"kind":"Field","name":{"kind":"Name","value":"to"}},{"kind":"Field","name":{"kind":"Name","value":"utilization"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"doctorName"}},{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"workMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"bookedMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"percent"}}]}},{"kind":"Field","name":{"kind":"Name","value":"rates"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bookings"}},{"kind":"Field","name":{"kind":"Name","value":"noShows"}},{"kind":"Field","name":{"kind":"Name","value":"lateCancels"}},{"kind":"Field","name":{"kind":"Name","value":"noShowPercent"}},{"kind":"Field","name":{"kind":"Name","value":"lateCancelPercent"}}]}},{"kind":"Field","name":{"kind":"Name","value":"waitlist"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"offered"}},{"kind":"Field","name":{"kind":"Name","value":"accepted"}},{"kind":"Field","name":{"kind":"Name","value":"acceptedPercent"}}]}},{"kind":"Field","name":{"kind":"Name","value":"revenue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceId"}},{"kind":"Field","name":{"kind":"Name","value":"serviceCode"}},{"kind":"Field","name":{"kind":"Name","value":"nameUk"}},{"kind":"Field","name":{"kind":"Name","value":"nameEn"}},{"kind":"Field","name":{"kind":"Name","value":"namePl"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"revenueMinor"}},{"kind":"Field","name":{"kind":"Name","value":"visits"}}]}}]}}]}}]} as unknown as DocumentNode<ReportQuery, ReportQueryVariables>;
export const DoctorWeeklyScheduleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DoctorWeeklySchedule"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"doctorId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"doctorWeeklySchedule"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"doctorId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"doctorId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"templates"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"weekday"}},{"kind":"Field","name":{"kind":"Name","value":"startLocal"}},{"kind":"Field","name":{"kind":"Name","value":"endLocal"}},{"kind":"Field","name":{"kind":"Name","value":"breakStartLocal"}},{"kind":"Field","name":{"kind":"Name","value":"breakEndLocal"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exceptions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"doctorId"}},{"kind":"Field","name":{"kind":"Name","value":"localDate"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"clinicId"}},{"kind":"Field","name":{"kind":"Name","value":"startLocal"}},{"kind":"Field","name":{"kind":"Name","value":"endLocal"}}]}}]}}]}}]} as unknown as DocumentNode<DoctorWeeklyScheduleQuery, DoctorWeeklyScheduleQueryVariables>;