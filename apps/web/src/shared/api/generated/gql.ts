/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  fragment AppointmentFields on Appointment {\n    id status kind startsAt endsAt localDate holdExpiresAt priceMinor currency version cancelledLate boardState\n    doctorId clinicId serviceId patientId\n    doctor { id fullName }\n    clinic { id city timeZone currency }\n    service { id nameUk nameEn namePl durationMin }\n    patient { id fullName phone }\n  }\n": typeof types.AppointmentFieldsFragmentDoc,
    "\n  query AppointmentHistory($id: ID!) { appointment(id: $id) { id events { type at actorRole late reason fromStatus toStatus oldStartsAt newStartsAt } } }\n": typeof types.AppointmentHistoryDocument,
    "query Clinics { clinics { id city timeZone currency } }": typeof types.ClinicsDocument,
    "\n  query ClinicServices($clinicId: ID!) {\n    clinicServices(clinicId: $clinicId) { priceMinor currency service { id code specialty nameUk nameEn namePl durationMin needsUltrasound } }\n  }\n": typeof types.ClinicServicesDocument,
    "\n  query ClinicDoctors($clinicId: ID!, $serviceId: ID) {\n    clinicDoctors(clinicId: $clinicId, serviceId: $serviceId) { id fullName specialty }\n  }\n": typeof types.ClinicDoctorsDocument,
    "\n  query Me {\n    me { id role email fullName patientId clinicId doctorId locale }\n  }\n": typeof types.MeDocument,
    "mutation SignOut { signOut }": typeof types.SignOutDocument,
    "\n  query Availability($input: AvailabilityInput!) {\n    availability(input: $input) {\n      clinicId timeZone currency durationMin priceMinor\n      doctors { id fullName specialty }\n      slots { doctorId startsAt endsAt localDate localTime }\n    }\n  }\n": typeof types.AvailabilityDocument,
    "\n  subscription AvailabilityChanged($clinicId: ID!, $doctorId: ID) {\n    availabilityChanged(clinicId: $clinicId, doctorId: $doctorId) { clinicId doctorId localDate }\n  }\n": typeof types.AvailabilityChangedDocument,
    "mutation CheckIn($id: ID!) { checkIn(id: $id) { id status boardState } }": typeof types.CheckInDocument,
    "mutation MarkNoShow($id: ID!) { markNoShow(id: $id) { id status boardState } }": typeof types.MarkNoShowDocument,
    "mutation CompleteVisit($id: ID!) { completeVisit(id: $id) { id status boardState } }": typeof types.CompleteVisitDocument,
    "mutation SignIn($input: SignInInput!) { signIn(input: $input) { id role } }": typeof types.SignInDocument,
    "mutation SignUp($input: SignUpInput!) { signUp(input: $input) { id role } }": typeof types.SignUpDocument,
    "mutation HoldSlot($input: HoldSlotInput!) { holdSlot(input: $input) { id holdExpiresAt } }": typeof types.HoldSlotDocument,
    "mutation ConfirmBooking($input: ConfirmBookingInput!) { confirmBooking(input: $input) { id status } }": typeof types.ConfirmBookingDocument,
    "mutation ReleaseHold($input: CancelInput!) { cancelAppointment(input: $input) { id status } }": typeof types.ReleaseHoldDocument,
    "mutation CancelAppointment($input: CancelInput!) { cancelAppointment(input: $input) { id status cancelledLate } }": typeof types.CancelAppointmentDocument,
    "mutation RescheduleAppointment($input: RescheduleInput!) { rescheduleAppointment(input: $input) { id startsAt version } }": typeof types.RescheduleAppointmentDocument,
    "query SearchPatients($query: String!) { searchPatients(query: $query) { id fullName phone onlineBookingBlockedUntil } }": typeof types.SearchPatientsDocument,
    "mutation RegistrarBook($input: RegistrarBookInput!) { registrarBook(input: $input) { id status startsAt } }": typeof types.RegistrarBookDocument,
    "mutation SetScheduleException($input: ExceptionInput!) { setScheduleException(input: $input) }": typeof types.SetScheduleExceptionDocument,
    "mutation MarkDoctorSick($input: MarkSickInput!) { markDoctorSick(input: $input) { cancelled alreadyMarked } }": typeof types.MarkDoctorSickDocument,
    "mutation RemoveScheduleTemplate($input: RemoveTemplateInput!) { removeScheduleTemplate(input: $input) }": typeof types.RemoveScheduleTemplateDocument,
    "mutation RemoveScheduleException($input: RemoveExceptionInput!) { removeScheduleException(input: $input) }": typeof types.RemoveScheduleExceptionDocument,
    "mutation SetScheduleTemplate($input: TemplateInput!) { setScheduleTemplate(input: $input) }": typeof types.SetScheduleTemplateDocument,
    "mutation JoinWaitlist($input: JoinWaitlistInput!) { joinWaitlist(input: $input) { id fromDate toDate } }": typeof types.JoinWaitlistDocument,
    "query MyWaitlist { myWaitlist { id fromDate toDate priority doctor { fullName } service { nameUk nameEn namePl } } }": typeof types.MyWaitlistDocument,
    "mutation LeaveWaitlist($id: ID!) { leaveWaitlist(id: $id) }": typeof types.LeaveWaitlistDocument,
    "\n  query MyOffers { myOffers { id expiresAt appointment { id startsAt clinic { timeZone } doctor { fullName } } } }\n": typeof types.MyOffersDocument,
    "subscription OfferWatch { myAppointmentChanged { id status } }": typeof types.OfferWatchDocument,
    "mutation AcceptOffer($input: RespondOfferInput!) { acceptOffer(input: $input) { id status } }": typeof types.AcceptOfferDocument,
    "mutation DeclineOffer($id: ID!) { declineOffer(id: $id) }": typeof types.DeclineOfferDocument,
    "query MyNotifications { myNotifications(limit: 10) { id kind createdAt readAt } }": typeof types.MyNotificationsDocument,
    "query DoctorWeek($from: String!) { doctorSchedule(fromDate: $from, days: 7) { ...AppointmentFields } }": typeof types.DoctorWeekDocument,
    "subscription DoctorChanged { doctorAppointmentChanged { id status } }": typeof types.DoctorChangedDocument,
    "\n  query MyAppointments($scope: VisitScope!) {\n    myAppointments(scope: $scope, limit: 30) { ...AppointmentFields }\n  }\n": typeof types.MyAppointmentsDocument,
    "subscription MyAppointmentsChanged { myAppointmentChanged { id status } }": typeof types.MyAppointmentsChangedDocument,
    "\n  query ClinicBoard($clinicId: ID!, $date: String!) { clinicBoard(clinicId: $clinicId, date: $date) { ...AppointmentFields } }\n": typeof types.ClinicBoardDocument,
    "subscription BoardChanged($clinicId: ID!) { clinicAppointmentChanged(clinicId: $clinicId) { id status } }": typeof types.BoardChangedDocument,
    "\n  query Report($from: String!, $to: String!, $clinicId: ID) {\n    report(from: $from, to: $to, clinicId: $clinicId) {\n      from to\n      utilization { doctorId doctorName clinicId workMinutes bookedMinutes percent }\n      rates { bookings noShows lateCancels noShowPercent lateCancelPercent }\n      waitlist { offered accepted acceptedPercent }\n      revenue { serviceId serviceCode currency revenueMinor visits }\n    }\n  }\n": typeof types.ReportDocument,
    "\n  query DoctorWeeklySchedule($doctorId: ID!) {\n    doctorWeeklySchedule(doctorId: $doctorId) {\n      doctorId\n      templates { doctorId clinicId weekday startLocal endLocal breakStartLocal breakEndLocal }\n      exceptions { doctorId localDate kind clinicId startLocal endLocal }\n    }\n  }\n": typeof types.DoctorWeeklyScheduleDocument,
};
const documents: Documents = {
    "\n  fragment AppointmentFields on Appointment {\n    id status kind startsAt endsAt localDate holdExpiresAt priceMinor currency version cancelledLate boardState\n    doctorId clinicId serviceId patientId\n    doctor { id fullName }\n    clinic { id city timeZone currency }\n    service { id nameUk nameEn namePl durationMin }\n    patient { id fullName phone }\n  }\n": types.AppointmentFieldsFragmentDoc,
    "\n  query AppointmentHistory($id: ID!) { appointment(id: $id) { id events { type at actorRole late reason fromStatus toStatus oldStartsAt newStartsAt } } }\n": types.AppointmentHistoryDocument,
    "query Clinics { clinics { id city timeZone currency } }": types.ClinicsDocument,
    "\n  query ClinicServices($clinicId: ID!) {\n    clinicServices(clinicId: $clinicId) { priceMinor currency service { id code specialty nameUk nameEn namePl durationMin needsUltrasound } }\n  }\n": types.ClinicServicesDocument,
    "\n  query ClinicDoctors($clinicId: ID!, $serviceId: ID) {\n    clinicDoctors(clinicId: $clinicId, serviceId: $serviceId) { id fullName specialty }\n  }\n": types.ClinicDoctorsDocument,
    "\n  query Me {\n    me { id role email fullName patientId clinicId doctorId locale }\n  }\n": types.MeDocument,
    "mutation SignOut { signOut }": types.SignOutDocument,
    "\n  query Availability($input: AvailabilityInput!) {\n    availability(input: $input) {\n      clinicId timeZone currency durationMin priceMinor\n      doctors { id fullName specialty }\n      slots { doctorId startsAt endsAt localDate localTime }\n    }\n  }\n": types.AvailabilityDocument,
    "\n  subscription AvailabilityChanged($clinicId: ID!, $doctorId: ID) {\n    availabilityChanged(clinicId: $clinicId, doctorId: $doctorId) { clinicId doctorId localDate }\n  }\n": types.AvailabilityChangedDocument,
    "mutation CheckIn($id: ID!) { checkIn(id: $id) { id status boardState } }": types.CheckInDocument,
    "mutation MarkNoShow($id: ID!) { markNoShow(id: $id) { id status boardState } }": types.MarkNoShowDocument,
    "mutation CompleteVisit($id: ID!) { completeVisit(id: $id) { id status boardState } }": types.CompleteVisitDocument,
    "mutation SignIn($input: SignInInput!) { signIn(input: $input) { id role } }": types.SignInDocument,
    "mutation SignUp($input: SignUpInput!) { signUp(input: $input) { id role } }": types.SignUpDocument,
    "mutation HoldSlot($input: HoldSlotInput!) { holdSlot(input: $input) { id holdExpiresAt } }": types.HoldSlotDocument,
    "mutation ConfirmBooking($input: ConfirmBookingInput!) { confirmBooking(input: $input) { id status } }": types.ConfirmBookingDocument,
    "mutation ReleaseHold($input: CancelInput!) { cancelAppointment(input: $input) { id status } }": types.ReleaseHoldDocument,
    "mutation CancelAppointment($input: CancelInput!) { cancelAppointment(input: $input) { id status cancelledLate } }": types.CancelAppointmentDocument,
    "mutation RescheduleAppointment($input: RescheduleInput!) { rescheduleAppointment(input: $input) { id startsAt version } }": types.RescheduleAppointmentDocument,
    "query SearchPatients($query: String!) { searchPatients(query: $query) { id fullName phone onlineBookingBlockedUntil } }": types.SearchPatientsDocument,
    "mutation RegistrarBook($input: RegistrarBookInput!) { registrarBook(input: $input) { id status startsAt } }": types.RegistrarBookDocument,
    "mutation SetScheduleException($input: ExceptionInput!) { setScheduleException(input: $input) }": types.SetScheduleExceptionDocument,
    "mutation MarkDoctorSick($input: MarkSickInput!) { markDoctorSick(input: $input) { cancelled alreadyMarked } }": types.MarkDoctorSickDocument,
    "mutation RemoveScheduleTemplate($input: RemoveTemplateInput!) { removeScheduleTemplate(input: $input) }": types.RemoveScheduleTemplateDocument,
    "mutation RemoveScheduleException($input: RemoveExceptionInput!) { removeScheduleException(input: $input) }": types.RemoveScheduleExceptionDocument,
    "mutation SetScheduleTemplate($input: TemplateInput!) { setScheduleTemplate(input: $input) }": types.SetScheduleTemplateDocument,
    "mutation JoinWaitlist($input: JoinWaitlistInput!) { joinWaitlist(input: $input) { id fromDate toDate } }": types.JoinWaitlistDocument,
    "query MyWaitlist { myWaitlist { id fromDate toDate priority doctor { fullName } service { nameUk nameEn namePl } } }": types.MyWaitlistDocument,
    "mutation LeaveWaitlist($id: ID!) { leaveWaitlist(id: $id) }": types.LeaveWaitlistDocument,
    "\n  query MyOffers { myOffers { id expiresAt appointment { id startsAt clinic { timeZone } doctor { fullName } } } }\n": types.MyOffersDocument,
    "subscription OfferWatch { myAppointmentChanged { id status } }": types.OfferWatchDocument,
    "mutation AcceptOffer($input: RespondOfferInput!) { acceptOffer(input: $input) { id status } }": types.AcceptOfferDocument,
    "mutation DeclineOffer($id: ID!) { declineOffer(id: $id) }": types.DeclineOfferDocument,
    "query MyNotifications { myNotifications(limit: 10) { id kind createdAt readAt } }": types.MyNotificationsDocument,
    "query DoctorWeek($from: String!) { doctorSchedule(fromDate: $from, days: 7) { ...AppointmentFields } }": types.DoctorWeekDocument,
    "subscription DoctorChanged { doctorAppointmentChanged { id status } }": types.DoctorChangedDocument,
    "\n  query MyAppointments($scope: VisitScope!) {\n    myAppointments(scope: $scope, limit: 30) { ...AppointmentFields }\n  }\n": types.MyAppointmentsDocument,
    "subscription MyAppointmentsChanged { myAppointmentChanged { id status } }": types.MyAppointmentsChangedDocument,
    "\n  query ClinicBoard($clinicId: ID!, $date: String!) { clinicBoard(clinicId: $clinicId, date: $date) { ...AppointmentFields } }\n": types.ClinicBoardDocument,
    "subscription BoardChanged($clinicId: ID!) { clinicAppointmentChanged(clinicId: $clinicId) { id status } }": types.BoardChangedDocument,
    "\n  query Report($from: String!, $to: String!, $clinicId: ID) {\n    report(from: $from, to: $to, clinicId: $clinicId) {\n      from to\n      utilization { doctorId doctorName clinicId workMinutes bookedMinutes percent }\n      rates { bookings noShows lateCancels noShowPercent lateCancelPercent }\n      waitlist { offered accepted acceptedPercent }\n      revenue { serviceId serviceCode currency revenueMinor visits }\n    }\n  }\n": types.ReportDocument,
    "\n  query DoctorWeeklySchedule($doctorId: ID!) {\n    doctorWeeklySchedule(doctorId: $doctorId) {\n      doctorId\n      templates { doctorId clinicId weekday startLocal endLocal breakStartLocal breakEndLocal }\n      exceptions { doctorId localDate kind clinicId startLocal endLocal }\n    }\n  }\n": types.DoctorWeeklyScheduleDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AppointmentFields on Appointment {\n    id status kind startsAt endsAt localDate holdExpiresAt priceMinor currency version cancelledLate boardState\n    doctorId clinicId serviceId patientId\n    doctor { id fullName }\n    clinic { id city timeZone currency }\n    service { id nameUk nameEn namePl durationMin }\n    patient { id fullName phone }\n  }\n"): (typeof documents)["\n  fragment AppointmentFields on Appointment {\n    id status kind startsAt endsAt localDate holdExpiresAt priceMinor currency version cancelledLate boardState\n    doctorId clinicId serviceId patientId\n    doctor { id fullName }\n    clinic { id city timeZone currency }\n    service { id nameUk nameEn namePl durationMin }\n    patient { id fullName phone }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AppointmentHistory($id: ID!) { appointment(id: $id) { id events { type at actorRole late reason fromStatus toStatus oldStartsAt newStartsAt } } }\n"): (typeof documents)["\n  query AppointmentHistory($id: ID!) { appointment(id: $id) { id events { type at actorRole late reason fromStatus toStatus oldStartsAt newStartsAt } } }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Clinics { clinics { id city timeZone currency } }"): (typeof documents)["query Clinics { clinics { id city timeZone currency } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ClinicServices($clinicId: ID!) {\n    clinicServices(clinicId: $clinicId) { priceMinor currency service { id code specialty nameUk nameEn namePl durationMin needsUltrasound } }\n  }\n"): (typeof documents)["\n  query ClinicServices($clinicId: ID!) {\n    clinicServices(clinicId: $clinicId) { priceMinor currency service { id code specialty nameUk nameEn namePl durationMin needsUltrasound } }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ClinicDoctors($clinicId: ID!, $serviceId: ID) {\n    clinicDoctors(clinicId: $clinicId, serviceId: $serviceId) { id fullName specialty }\n  }\n"): (typeof documents)["\n  query ClinicDoctors($clinicId: ID!, $serviceId: ID) {\n    clinicDoctors(clinicId: $clinicId, serviceId: $serviceId) { id fullName specialty }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Me {\n    me { id role email fullName patientId clinicId doctorId locale }\n  }\n"): (typeof documents)["\n  query Me {\n    me { id role email fullName patientId clinicId doctorId locale }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation SignOut { signOut }"): (typeof documents)["mutation SignOut { signOut }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Availability($input: AvailabilityInput!) {\n    availability(input: $input) {\n      clinicId timeZone currency durationMin priceMinor\n      doctors { id fullName specialty }\n      slots { doctorId startsAt endsAt localDate localTime }\n    }\n  }\n"): (typeof documents)["\n  query Availability($input: AvailabilityInput!) {\n    availability(input: $input) {\n      clinicId timeZone currency durationMin priceMinor\n      doctors { id fullName specialty }\n      slots { doctorId startsAt endsAt localDate localTime }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription AvailabilityChanged($clinicId: ID!, $doctorId: ID) {\n    availabilityChanged(clinicId: $clinicId, doctorId: $doctorId) { clinicId doctorId localDate }\n  }\n"): (typeof documents)["\n  subscription AvailabilityChanged($clinicId: ID!, $doctorId: ID) {\n    availabilityChanged(clinicId: $clinicId, doctorId: $doctorId) { clinicId doctorId localDate }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CheckIn($id: ID!) { checkIn(id: $id) { id status boardState } }"): (typeof documents)["mutation CheckIn($id: ID!) { checkIn(id: $id) { id status boardState } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation MarkNoShow($id: ID!) { markNoShow(id: $id) { id status boardState } }"): (typeof documents)["mutation MarkNoShow($id: ID!) { markNoShow(id: $id) { id status boardState } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CompleteVisit($id: ID!) { completeVisit(id: $id) { id status boardState } }"): (typeof documents)["mutation CompleteVisit($id: ID!) { completeVisit(id: $id) { id status boardState } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation SignIn($input: SignInInput!) { signIn(input: $input) { id role } }"): (typeof documents)["mutation SignIn($input: SignInInput!) { signIn(input: $input) { id role } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation SignUp($input: SignUpInput!) { signUp(input: $input) { id role } }"): (typeof documents)["mutation SignUp($input: SignUpInput!) { signUp(input: $input) { id role } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation HoldSlot($input: HoldSlotInput!) { holdSlot(input: $input) { id holdExpiresAt } }"): (typeof documents)["mutation HoldSlot($input: HoldSlotInput!) { holdSlot(input: $input) { id holdExpiresAt } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ConfirmBooking($input: ConfirmBookingInput!) { confirmBooking(input: $input) { id status } }"): (typeof documents)["mutation ConfirmBooking($input: ConfirmBookingInput!) { confirmBooking(input: $input) { id status } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ReleaseHold($input: CancelInput!) { cancelAppointment(input: $input) { id status } }"): (typeof documents)["mutation ReleaseHold($input: CancelInput!) { cancelAppointment(input: $input) { id status } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CancelAppointment($input: CancelInput!) { cancelAppointment(input: $input) { id status cancelledLate } }"): (typeof documents)["mutation CancelAppointment($input: CancelInput!) { cancelAppointment(input: $input) { id status cancelledLate } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RescheduleAppointment($input: RescheduleInput!) { rescheduleAppointment(input: $input) { id startsAt version } }"): (typeof documents)["mutation RescheduleAppointment($input: RescheduleInput!) { rescheduleAppointment(input: $input) { id startsAt version } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query SearchPatients($query: String!) { searchPatients(query: $query) { id fullName phone onlineBookingBlockedUntil } }"): (typeof documents)["query SearchPatients($query: String!) { searchPatients(query: $query) { id fullName phone onlineBookingBlockedUntil } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RegistrarBook($input: RegistrarBookInput!) { registrarBook(input: $input) { id status startsAt } }"): (typeof documents)["mutation RegistrarBook($input: RegistrarBookInput!) { registrarBook(input: $input) { id status startsAt } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation SetScheduleException($input: ExceptionInput!) { setScheduleException(input: $input) }"): (typeof documents)["mutation SetScheduleException($input: ExceptionInput!) { setScheduleException(input: $input) }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation MarkDoctorSick($input: MarkSickInput!) { markDoctorSick(input: $input) { cancelled alreadyMarked } }"): (typeof documents)["mutation MarkDoctorSick($input: MarkSickInput!) { markDoctorSick(input: $input) { cancelled alreadyMarked } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RemoveScheduleTemplate($input: RemoveTemplateInput!) { removeScheduleTemplate(input: $input) }"): (typeof documents)["mutation RemoveScheduleTemplate($input: RemoveTemplateInput!) { removeScheduleTemplate(input: $input) }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RemoveScheduleException($input: RemoveExceptionInput!) { removeScheduleException(input: $input) }"): (typeof documents)["mutation RemoveScheduleException($input: RemoveExceptionInput!) { removeScheduleException(input: $input) }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation SetScheduleTemplate($input: TemplateInput!) { setScheduleTemplate(input: $input) }"): (typeof documents)["mutation SetScheduleTemplate($input: TemplateInput!) { setScheduleTemplate(input: $input) }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation JoinWaitlist($input: JoinWaitlistInput!) { joinWaitlist(input: $input) { id fromDate toDate } }"): (typeof documents)["mutation JoinWaitlist($input: JoinWaitlistInput!) { joinWaitlist(input: $input) { id fromDate toDate } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MyWaitlist { myWaitlist { id fromDate toDate priority doctor { fullName } service { nameUk nameEn namePl } } }"): (typeof documents)["query MyWaitlist { myWaitlist { id fromDate toDate priority doctor { fullName } service { nameUk nameEn namePl } } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation LeaveWaitlist($id: ID!) { leaveWaitlist(id: $id) }"): (typeof documents)["mutation LeaveWaitlist($id: ID!) { leaveWaitlist(id: $id) }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyOffers { myOffers { id expiresAt appointment { id startsAt clinic { timeZone } doctor { fullName } } } }\n"): (typeof documents)["\n  query MyOffers { myOffers { id expiresAt appointment { id startsAt clinic { timeZone } doctor { fullName } } } }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "subscription OfferWatch { myAppointmentChanged { id status } }"): (typeof documents)["subscription OfferWatch { myAppointmentChanged { id status } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AcceptOffer($input: RespondOfferInput!) { acceptOffer(input: $input) { id status } }"): (typeof documents)["mutation AcceptOffer($input: RespondOfferInput!) { acceptOffer(input: $input) { id status } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeclineOffer($id: ID!) { declineOffer(id: $id) }"): (typeof documents)["mutation DeclineOffer($id: ID!) { declineOffer(id: $id) }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MyNotifications { myNotifications(limit: 10) { id kind createdAt readAt } }"): (typeof documents)["query MyNotifications { myNotifications(limit: 10) { id kind createdAt readAt } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query DoctorWeek($from: String!) { doctorSchedule(fromDate: $from, days: 7) { ...AppointmentFields } }"): (typeof documents)["query DoctorWeek($from: String!) { doctorSchedule(fromDate: $from, days: 7) { ...AppointmentFields } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "subscription DoctorChanged { doctorAppointmentChanged { id status } }"): (typeof documents)["subscription DoctorChanged { doctorAppointmentChanged { id status } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyAppointments($scope: VisitScope!) {\n    myAppointments(scope: $scope, limit: 30) { ...AppointmentFields }\n  }\n"): (typeof documents)["\n  query MyAppointments($scope: VisitScope!) {\n    myAppointments(scope: $scope, limit: 30) { ...AppointmentFields }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "subscription MyAppointmentsChanged { myAppointmentChanged { id status } }"): (typeof documents)["subscription MyAppointmentsChanged { myAppointmentChanged { id status } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ClinicBoard($clinicId: ID!, $date: String!) { clinicBoard(clinicId: $clinicId, date: $date) { ...AppointmentFields } }\n"): (typeof documents)["\n  query ClinicBoard($clinicId: ID!, $date: String!) { clinicBoard(clinicId: $clinicId, date: $date) { ...AppointmentFields } }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "subscription BoardChanged($clinicId: ID!) { clinicAppointmentChanged(clinicId: $clinicId) { id status } }"): (typeof documents)["subscription BoardChanged($clinicId: ID!) { clinicAppointmentChanged(clinicId: $clinicId) { id status } }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Report($from: String!, $to: String!, $clinicId: ID) {\n    report(from: $from, to: $to, clinicId: $clinicId) {\n      from to\n      utilization { doctorId doctorName clinicId workMinutes bookedMinutes percent }\n      rates { bookings noShows lateCancels noShowPercent lateCancelPercent }\n      waitlist { offered accepted acceptedPercent }\n      revenue { serviceId serviceCode currency revenueMinor visits }\n    }\n  }\n"): (typeof documents)["\n  query Report($from: String!, $to: String!, $clinicId: ID) {\n    report(from: $from, to: $to, clinicId: $clinicId) {\n      from to\n      utilization { doctorId doctorName clinicId workMinutes bookedMinutes percent }\n      rates { bookings noShows lateCancels noShowPercent lateCancelPercent }\n      waitlist { offered accepted acceptedPercent }\n      revenue { serviceId serviceCode currency revenueMinor visits }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query DoctorWeeklySchedule($doctorId: ID!) {\n    doctorWeeklySchedule(doctorId: $doctorId) {\n      doctorId\n      templates { doctorId clinicId weekday startLocal endLocal breakStartLocal breakEndLocal }\n      exceptions { doctorId localDate kind clinicId startLocal endLocal }\n    }\n  }\n"): (typeof documents)["\n  query DoctorWeeklySchedule($doctorId: ID!) {\n    doctorWeeklySchedule(doctorId: $doctorId) {\n      doctorId\n      templates { doctorId clinicId weekday startLocal endLocal breakStartLocal breakEndLocal }\n      exceptions { doctorId localDate kind clinicId startLocal endLocal }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;