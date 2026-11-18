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
    "\n  fragment AppointmentFields on Appointment {\n    id\n    status\n    kind\n    startsAt\n    endsAt\n    localDate\n    holdExpiresAt\n    priceMinor\n    currency\n    version\n    cancelledLate\n    boardState\n    doctorId\n    clinicId\n    serviceId\n    patientId\n    doctor {\n      id\n      fullName\n    }\n    clinic {\n      id\n      city\n      timeZone\n      currency\n    }\n    service {\n      id\n      nameUk\n      nameEn\n      namePl\n      durationMin\n    }\n    patient {\n      id\n      fullName\n      phone\n    }\n  }\n": typeof types.AppointmentFieldsFragmentDoc,
    "\n  query AppointmentHistory($id: ID!) {\n    appointment(id: $id) {\n      id\n      events {\n        type\n        at\n        actorRole\n        late\n        reason\n        fromStatus\n        toStatus\n        oldStartsAt\n        newStartsAt\n      }\n    }\n  }\n": typeof types.AppointmentHistoryDocument,
    "\n  query Clinics {\n    clinics {\n      id\n      city\n      timeZone\n      currency\n    }\n  }\n": typeof types.ClinicsDocument,
    "\n  query ClinicServices($clinicId: ID!) {\n    clinicServices(clinicId: $clinicId) {\n      priceMinor\n      currency\n      service {\n        id\n        code\n        specialty\n        nameUk\n        nameEn\n        namePl\n        durationMin\n        needsUltrasound\n      }\n    }\n  }\n": typeof types.ClinicServicesDocument,
    "\n  query ClinicDoctors($clinicId: ID!, $serviceId: ID) {\n    clinicDoctors(clinicId: $clinicId, serviceId: $serviceId) {\n      id\n      fullName\n      specialty\n    }\n  }\n": typeof types.ClinicDoctorsDocument,
    "\n  query Me {\n    me {\n      id\n      role\n      email\n      fullName\n      patientId\n      clinicId\n      doctorId\n      locale\n    }\n  }\n": typeof types.MeDocument,
    "\n  mutation SignOut {\n    signOut\n  }\n": typeof types.SignOutDocument,
    "\n  query Availability($input: AvailabilityInput!) {\n    availability(input: $input) {\n      clinicId\n      timeZone\n      currency\n      durationMin\n      priceMinor\n      doctors {\n        id\n        fullName\n        specialty\n      }\n      slots {\n        doctorId\n        startsAt\n        endsAt\n        localDate\n        localTime\n      }\n    }\n  }\n": typeof types.AvailabilityDocument,
    "\n  subscription AvailabilityChanged($clinicId: ID!, $doctorId: ID) {\n    availabilityChanged(clinicId: $clinicId, doctorId: $doctorId) {\n      clinicId\n      doctorId\n      localDate\n    }\n  }\n": typeof types.AvailabilityChangedDocument,
    "\n  mutation CheckIn($id: ID!) {\n    checkIn(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n": typeof types.CheckInDocument,
    "\n  mutation MarkNoShow($id: ID!) {\n    markNoShow(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n": typeof types.MarkNoShowDocument,
    "\n  mutation CompleteVisit($id: ID!) {\n    completeVisit(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n": typeof types.CompleteVisitDocument,
    "\n  mutation SignIn($input: SignInInput!) {\n    signIn(input: $input) {\n      id\n      role\n    }\n  }\n": typeof types.SignInDocument,
    "\n  mutation SignUp($input: SignUpInput!) {\n    signUp(input: $input) {\n      id\n      role\n    }\n  }\n": typeof types.SignUpDocument,
    "\n  mutation HoldSlot($input: HoldSlotInput!) {\n    holdSlot(input: $input) {\n      id\n      holdExpiresAt\n    }\n  }\n": typeof types.HoldSlotDocument,
    "\n  mutation ConfirmBooking($input: ConfirmBookingInput!) {\n    confirmBooking(input: $input) {\n      id\n      status\n    }\n  }\n": typeof types.ConfirmBookingDocument,
    "\n  mutation ReleaseHold($input: CancelInput!) {\n    cancelAppointment(input: $input) {\n      id\n      status\n    }\n  }\n": typeof types.ReleaseHoldDocument,
    "\n  subscription HoldWatch {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n": typeof types.HoldWatchDocument,
    "\n  query HoldStatus {\n    myAppointments(scope: UPCOMING, limit: 30) {\n      id\n      status\n    }\n  }\n": typeof types.HoldStatusDocument,
    "\n  mutation CancelAppointment($input: CancelInput!) {\n    cancelAppointment(input: $input) {\n      id\n      status\n      cancelledLate\n    }\n  }\n": typeof types.CancelAppointmentDocument,
    "\n  mutation RescheduleAppointment($input: RescheduleInput!) {\n    rescheduleAppointment(input: $input) {\n      id\n      startsAt\n      version\n    }\n  }\n": typeof types.RescheduleAppointmentDocument,
    "\n  query SearchPatients($query: String!) {\n    searchPatients(query: $query) {\n      id\n      fullName\n      phone\n      onlineBookingBlockedUntil\n    }\n  }\n": typeof types.SearchPatientsDocument,
    "\n  mutation RegistrarBook($input: RegistrarBookInput!) {\n    registrarBook(input: $input) {\n      id\n      status\n      startsAt\n    }\n  }\n": typeof types.RegistrarBookDocument,
    "\n  mutation SetScheduleException($input: ExceptionInput!) {\n    setScheduleException(input: $input)\n  }\n": typeof types.SetScheduleExceptionDocument,
    "\n  mutation MarkDoctorSick($input: MarkSickInput!) {\n    markDoctorSick(input: $input) {\n      cancelled\n      alreadyMarked\n    }\n  }\n": typeof types.MarkDoctorSickDocument,
    "\n  mutation RemoveScheduleTemplate($input: RemoveTemplateInput!) {\n    removeScheduleTemplate(input: $input)\n  }\n": typeof types.RemoveScheduleTemplateDocument,
    "\n  mutation RemoveScheduleException($input: RemoveExceptionInput!) {\n    removeScheduleException(input: $input)\n  }\n": typeof types.RemoveScheduleExceptionDocument,
    "\n  mutation SetScheduleTemplate($input: TemplateInput!) {\n    setScheduleTemplate(input: $input)\n  }\n": typeof types.SetScheduleTemplateDocument,
    "\n  mutation JoinWaitlist($input: JoinWaitlistInput!) {\n    joinWaitlist(input: $input) {\n      id\n      fromDate\n      toDate\n    }\n  }\n": typeof types.JoinWaitlistDocument,
    "\n  query MyWaitlist {\n    myWaitlist {\n      id\n      fromDate\n      toDate\n      priority\n      doctor {\n        fullName\n      }\n      service {\n        nameUk\n        nameEn\n        namePl\n      }\n    }\n  }\n": typeof types.MyWaitlistDocument,
    "\n  mutation LeaveWaitlist($id: ID!) {\n    leaveWaitlist(id: $id)\n  }\n": typeof types.LeaveWaitlistDocument,
    "\n  query MyOffers {\n    myOffers {\n      id\n      expiresAt\n      appointment {\n        id\n        startsAt\n        clinic {\n          timeZone\n        }\n        doctor {\n          fullName\n        }\n      }\n    }\n  }\n": typeof types.MyOffersDocument,
    "\n  subscription OfferWatch {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n": typeof types.OfferWatchDocument,
    "\n  mutation AcceptOffer($input: RespondOfferInput!) {\n    acceptOffer(input: $input) {\n      id\n      status\n    }\n  }\n": typeof types.AcceptOfferDocument,
    "\n  mutation DeclineOffer($id: ID!) {\n    declineOffer(id: $id)\n  }\n": typeof types.DeclineOfferDocument,
    "\n  query MyNotifications {\n    myNotifications(limit: 10) {\n      id\n      kind\n      createdAt\n      readAt\n    }\n  }\n": typeof types.MyNotificationsDocument,
    "\n  query DoctorWeek($from: String!) {\n    doctorSchedule(fromDate: $from, days: 7) {\n      ...AppointmentFields\n    }\n  }\n": typeof types.DoctorWeekDocument,
    "\n  subscription DoctorChanged {\n    doctorAppointmentChanged {\n      id\n      status\n    }\n  }\n": typeof types.DoctorChangedDocument,
    "\n  query MyAppointments($scope: VisitScope!) {\n    myAppointments(scope: $scope, limit: 30) {\n      ...AppointmentFields\n    }\n  }\n": typeof types.MyAppointmentsDocument,
    "\n  subscription MyAppointmentsChanged {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n": typeof types.MyAppointmentsChangedDocument,
    "\n  query ClinicBoard($clinicId: ID!, $date: String!) {\n    clinicBoard(clinicId: $clinicId, date: $date) {\n      ...AppointmentFields\n    }\n  }\n": typeof types.ClinicBoardDocument,
    "\n  subscription BoardChanged($clinicId: ID!) {\n    clinicAppointmentChanged(clinicId: $clinicId) {\n      id\n      status\n    }\n  }\n": typeof types.BoardChangedDocument,
    "\n  query Report($from: String!, $to: String!, $clinicId: ID) {\n    report(from: $from, to: $to, clinicId: $clinicId) {\n      from\n      to\n      utilization {\n        doctorId\n        doctorName\n        clinicId\n        workMinutes\n        bookedMinutes\n        percent\n      }\n      rates {\n        bookings\n        noShows\n        lateCancels\n        noShowPercent\n        lateCancelPercent\n      }\n      waitlist {\n        offered\n        accepted\n        acceptedPercent\n      }\n      revenue {\n        serviceId\n        serviceCode\n        nameUk\n        nameEn\n        namePl\n        currency\n        revenueMinor\n        visits\n      }\n    }\n  }\n": typeof types.ReportDocument,
    "\n  query DoctorWeeklySchedule($doctorId: ID!) {\n    doctorWeeklySchedule(doctorId: $doctorId) {\n      doctorId\n      templates {\n        doctorId\n        clinicId\n        weekday\n        startLocal\n        endLocal\n        breakStartLocal\n        breakEndLocal\n      }\n      exceptions {\n        doctorId\n        localDate\n        kind\n        clinicId\n        startLocal\n        endLocal\n      }\n    }\n  }\n": typeof types.DoctorWeeklyScheduleDocument,
};
const documents: Documents = {
    "\n  fragment AppointmentFields on Appointment {\n    id\n    status\n    kind\n    startsAt\n    endsAt\n    localDate\n    holdExpiresAt\n    priceMinor\n    currency\n    version\n    cancelledLate\n    boardState\n    doctorId\n    clinicId\n    serviceId\n    patientId\n    doctor {\n      id\n      fullName\n    }\n    clinic {\n      id\n      city\n      timeZone\n      currency\n    }\n    service {\n      id\n      nameUk\n      nameEn\n      namePl\n      durationMin\n    }\n    patient {\n      id\n      fullName\n      phone\n    }\n  }\n": types.AppointmentFieldsFragmentDoc,
    "\n  query AppointmentHistory($id: ID!) {\n    appointment(id: $id) {\n      id\n      events {\n        type\n        at\n        actorRole\n        late\n        reason\n        fromStatus\n        toStatus\n        oldStartsAt\n        newStartsAt\n      }\n    }\n  }\n": types.AppointmentHistoryDocument,
    "\n  query Clinics {\n    clinics {\n      id\n      city\n      timeZone\n      currency\n    }\n  }\n": types.ClinicsDocument,
    "\n  query ClinicServices($clinicId: ID!) {\n    clinicServices(clinicId: $clinicId) {\n      priceMinor\n      currency\n      service {\n        id\n        code\n        specialty\n        nameUk\n        nameEn\n        namePl\n        durationMin\n        needsUltrasound\n      }\n    }\n  }\n": types.ClinicServicesDocument,
    "\n  query ClinicDoctors($clinicId: ID!, $serviceId: ID) {\n    clinicDoctors(clinicId: $clinicId, serviceId: $serviceId) {\n      id\n      fullName\n      specialty\n    }\n  }\n": types.ClinicDoctorsDocument,
    "\n  query Me {\n    me {\n      id\n      role\n      email\n      fullName\n      patientId\n      clinicId\n      doctorId\n      locale\n    }\n  }\n": types.MeDocument,
    "\n  mutation SignOut {\n    signOut\n  }\n": types.SignOutDocument,
    "\n  query Availability($input: AvailabilityInput!) {\n    availability(input: $input) {\n      clinicId\n      timeZone\n      currency\n      durationMin\n      priceMinor\n      doctors {\n        id\n        fullName\n        specialty\n      }\n      slots {\n        doctorId\n        startsAt\n        endsAt\n        localDate\n        localTime\n      }\n    }\n  }\n": types.AvailabilityDocument,
    "\n  subscription AvailabilityChanged($clinicId: ID!, $doctorId: ID) {\n    availabilityChanged(clinicId: $clinicId, doctorId: $doctorId) {\n      clinicId\n      doctorId\n      localDate\n    }\n  }\n": types.AvailabilityChangedDocument,
    "\n  mutation CheckIn($id: ID!) {\n    checkIn(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n": types.CheckInDocument,
    "\n  mutation MarkNoShow($id: ID!) {\n    markNoShow(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n": types.MarkNoShowDocument,
    "\n  mutation CompleteVisit($id: ID!) {\n    completeVisit(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n": types.CompleteVisitDocument,
    "\n  mutation SignIn($input: SignInInput!) {\n    signIn(input: $input) {\n      id\n      role\n    }\n  }\n": types.SignInDocument,
    "\n  mutation SignUp($input: SignUpInput!) {\n    signUp(input: $input) {\n      id\n      role\n    }\n  }\n": types.SignUpDocument,
    "\n  mutation HoldSlot($input: HoldSlotInput!) {\n    holdSlot(input: $input) {\n      id\n      holdExpiresAt\n    }\n  }\n": types.HoldSlotDocument,
    "\n  mutation ConfirmBooking($input: ConfirmBookingInput!) {\n    confirmBooking(input: $input) {\n      id\n      status\n    }\n  }\n": types.ConfirmBookingDocument,
    "\n  mutation ReleaseHold($input: CancelInput!) {\n    cancelAppointment(input: $input) {\n      id\n      status\n    }\n  }\n": types.ReleaseHoldDocument,
    "\n  subscription HoldWatch {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n": types.HoldWatchDocument,
    "\n  query HoldStatus {\n    myAppointments(scope: UPCOMING, limit: 30) {\n      id\n      status\n    }\n  }\n": types.HoldStatusDocument,
    "\n  mutation CancelAppointment($input: CancelInput!) {\n    cancelAppointment(input: $input) {\n      id\n      status\n      cancelledLate\n    }\n  }\n": types.CancelAppointmentDocument,
    "\n  mutation RescheduleAppointment($input: RescheduleInput!) {\n    rescheduleAppointment(input: $input) {\n      id\n      startsAt\n      version\n    }\n  }\n": types.RescheduleAppointmentDocument,
    "\n  query SearchPatients($query: String!) {\n    searchPatients(query: $query) {\n      id\n      fullName\n      phone\n      onlineBookingBlockedUntil\n    }\n  }\n": types.SearchPatientsDocument,
    "\n  mutation RegistrarBook($input: RegistrarBookInput!) {\n    registrarBook(input: $input) {\n      id\n      status\n      startsAt\n    }\n  }\n": types.RegistrarBookDocument,
    "\n  mutation SetScheduleException($input: ExceptionInput!) {\n    setScheduleException(input: $input)\n  }\n": types.SetScheduleExceptionDocument,
    "\n  mutation MarkDoctorSick($input: MarkSickInput!) {\n    markDoctorSick(input: $input) {\n      cancelled\n      alreadyMarked\n    }\n  }\n": types.MarkDoctorSickDocument,
    "\n  mutation RemoveScheduleTemplate($input: RemoveTemplateInput!) {\n    removeScheduleTemplate(input: $input)\n  }\n": types.RemoveScheduleTemplateDocument,
    "\n  mutation RemoveScheduleException($input: RemoveExceptionInput!) {\n    removeScheduleException(input: $input)\n  }\n": types.RemoveScheduleExceptionDocument,
    "\n  mutation SetScheduleTemplate($input: TemplateInput!) {\n    setScheduleTemplate(input: $input)\n  }\n": types.SetScheduleTemplateDocument,
    "\n  mutation JoinWaitlist($input: JoinWaitlistInput!) {\n    joinWaitlist(input: $input) {\n      id\n      fromDate\n      toDate\n    }\n  }\n": types.JoinWaitlistDocument,
    "\n  query MyWaitlist {\n    myWaitlist {\n      id\n      fromDate\n      toDate\n      priority\n      doctor {\n        fullName\n      }\n      service {\n        nameUk\n        nameEn\n        namePl\n      }\n    }\n  }\n": types.MyWaitlistDocument,
    "\n  mutation LeaveWaitlist($id: ID!) {\n    leaveWaitlist(id: $id)\n  }\n": types.LeaveWaitlistDocument,
    "\n  query MyOffers {\n    myOffers {\n      id\n      expiresAt\n      appointment {\n        id\n        startsAt\n        clinic {\n          timeZone\n        }\n        doctor {\n          fullName\n        }\n      }\n    }\n  }\n": types.MyOffersDocument,
    "\n  subscription OfferWatch {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n": types.OfferWatchDocument,
    "\n  mutation AcceptOffer($input: RespondOfferInput!) {\n    acceptOffer(input: $input) {\n      id\n      status\n    }\n  }\n": types.AcceptOfferDocument,
    "\n  mutation DeclineOffer($id: ID!) {\n    declineOffer(id: $id)\n  }\n": types.DeclineOfferDocument,
    "\n  query MyNotifications {\n    myNotifications(limit: 10) {\n      id\n      kind\n      createdAt\n      readAt\n    }\n  }\n": types.MyNotificationsDocument,
    "\n  query DoctorWeek($from: String!) {\n    doctorSchedule(fromDate: $from, days: 7) {\n      ...AppointmentFields\n    }\n  }\n": types.DoctorWeekDocument,
    "\n  subscription DoctorChanged {\n    doctorAppointmentChanged {\n      id\n      status\n    }\n  }\n": types.DoctorChangedDocument,
    "\n  query MyAppointments($scope: VisitScope!) {\n    myAppointments(scope: $scope, limit: 30) {\n      ...AppointmentFields\n    }\n  }\n": types.MyAppointmentsDocument,
    "\n  subscription MyAppointmentsChanged {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n": types.MyAppointmentsChangedDocument,
    "\n  query ClinicBoard($clinicId: ID!, $date: String!) {\n    clinicBoard(clinicId: $clinicId, date: $date) {\n      ...AppointmentFields\n    }\n  }\n": types.ClinicBoardDocument,
    "\n  subscription BoardChanged($clinicId: ID!) {\n    clinicAppointmentChanged(clinicId: $clinicId) {\n      id\n      status\n    }\n  }\n": types.BoardChangedDocument,
    "\n  query Report($from: String!, $to: String!, $clinicId: ID) {\n    report(from: $from, to: $to, clinicId: $clinicId) {\n      from\n      to\n      utilization {\n        doctorId\n        doctorName\n        clinicId\n        workMinutes\n        bookedMinutes\n        percent\n      }\n      rates {\n        bookings\n        noShows\n        lateCancels\n        noShowPercent\n        lateCancelPercent\n      }\n      waitlist {\n        offered\n        accepted\n        acceptedPercent\n      }\n      revenue {\n        serviceId\n        serviceCode\n        nameUk\n        nameEn\n        namePl\n        currency\n        revenueMinor\n        visits\n      }\n    }\n  }\n": types.ReportDocument,
    "\n  query DoctorWeeklySchedule($doctorId: ID!) {\n    doctorWeeklySchedule(doctorId: $doctorId) {\n      doctorId\n      templates {\n        doctorId\n        clinicId\n        weekday\n        startLocal\n        endLocal\n        breakStartLocal\n        breakEndLocal\n      }\n      exceptions {\n        doctorId\n        localDate\n        kind\n        clinicId\n        startLocal\n        endLocal\n      }\n    }\n  }\n": types.DoctorWeeklyScheduleDocument,
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
export function graphql(source: "\n  fragment AppointmentFields on Appointment {\n    id\n    status\n    kind\n    startsAt\n    endsAt\n    localDate\n    holdExpiresAt\n    priceMinor\n    currency\n    version\n    cancelledLate\n    boardState\n    doctorId\n    clinicId\n    serviceId\n    patientId\n    doctor {\n      id\n      fullName\n    }\n    clinic {\n      id\n      city\n      timeZone\n      currency\n    }\n    service {\n      id\n      nameUk\n      nameEn\n      namePl\n      durationMin\n    }\n    patient {\n      id\n      fullName\n      phone\n    }\n  }\n"): (typeof documents)["\n  fragment AppointmentFields on Appointment {\n    id\n    status\n    kind\n    startsAt\n    endsAt\n    localDate\n    holdExpiresAt\n    priceMinor\n    currency\n    version\n    cancelledLate\n    boardState\n    doctorId\n    clinicId\n    serviceId\n    patientId\n    doctor {\n      id\n      fullName\n    }\n    clinic {\n      id\n      city\n      timeZone\n      currency\n    }\n    service {\n      id\n      nameUk\n      nameEn\n      namePl\n      durationMin\n    }\n    patient {\n      id\n      fullName\n      phone\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AppointmentHistory($id: ID!) {\n    appointment(id: $id) {\n      id\n      events {\n        type\n        at\n        actorRole\n        late\n        reason\n        fromStatus\n        toStatus\n        oldStartsAt\n        newStartsAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query AppointmentHistory($id: ID!) {\n    appointment(id: $id) {\n      id\n      events {\n        type\n        at\n        actorRole\n        late\n        reason\n        fromStatus\n        toStatus\n        oldStartsAt\n        newStartsAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Clinics {\n    clinics {\n      id\n      city\n      timeZone\n      currency\n    }\n  }\n"): (typeof documents)["\n  query Clinics {\n    clinics {\n      id\n      city\n      timeZone\n      currency\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ClinicServices($clinicId: ID!) {\n    clinicServices(clinicId: $clinicId) {\n      priceMinor\n      currency\n      service {\n        id\n        code\n        specialty\n        nameUk\n        nameEn\n        namePl\n        durationMin\n        needsUltrasound\n      }\n    }\n  }\n"): (typeof documents)["\n  query ClinicServices($clinicId: ID!) {\n    clinicServices(clinicId: $clinicId) {\n      priceMinor\n      currency\n      service {\n        id\n        code\n        specialty\n        nameUk\n        nameEn\n        namePl\n        durationMin\n        needsUltrasound\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ClinicDoctors($clinicId: ID!, $serviceId: ID) {\n    clinicDoctors(clinicId: $clinicId, serviceId: $serviceId) {\n      id\n      fullName\n      specialty\n    }\n  }\n"): (typeof documents)["\n  query ClinicDoctors($clinicId: ID!, $serviceId: ID) {\n    clinicDoctors(clinicId: $clinicId, serviceId: $serviceId) {\n      id\n      fullName\n      specialty\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Me {\n    me {\n      id\n      role\n      email\n      fullName\n      patientId\n      clinicId\n      doctorId\n      locale\n    }\n  }\n"): (typeof documents)["\n  query Me {\n    me {\n      id\n      role\n      email\n      fullName\n      patientId\n      clinicId\n      doctorId\n      locale\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SignOut {\n    signOut\n  }\n"): (typeof documents)["\n  mutation SignOut {\n    signOut\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Availability($input: AvailabilityInput!) {\n    availability(input: $input) {\n      clinicId\n      timeZone\n      currency\n      durationMin\n      priceMinor\n      doctors {\n        id\n        fullName\n        specialty\n      }\n      slots {\n        doctorId\n        startsAt\n        endsAt\n        localDate\n        localTime\n      }\n    }\n  }\n"): (typeof documents)["\n  query Availability($input: AvailabilityInput!) {\n    availability(input: $input) {\n      clinicId\n      timeZone\n      currency\n      durationMin\n      priceMinor\n      doctors {\n        id\n        fullName\n        specialty\n      }\n      slots {\n        doctorId\n        startsAt\n        endsAt\n        localDate\n        localTime\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription AvailabilityChanged($clinicId: ID!, $doctorId: ID) {\n    availabilityChanged(clinicId: $clinicId, doctorId: $doctorId) {\n      clinicId\n      doctorId\n      localDate\n    }\n  }\n"): (typeof documents)["\n  subscription AvailabilityChanged($clinicId: ID!, $doctorId: ID) {\n    availabilityChanged(clinicId: $clinicId, doctorId: $doctorId) {\n      clinicId\n      doctorId\n      localDate\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CheckIn($id: ID!) {\n    checkIn(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n"): (typeof documents)["\n  mutation CheckIn($id: ID!) {\n    checkIn(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MarkNoShow($id: ID!) {\n    markNoShow(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n"): (typeof documents)["\n  mutation MarkNoShow($id: ID!) {\n    markNoShow(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CompleteVisit($id: ID!) {\n    completeVisit(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n"): (typeof documents)["\n  mutation CompleteVisit($id: ID!) {\n    completeVisit(id: $id) {\n      id\n      status\n      boardState\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SignIn($input: SignInInput!) {\n    signIn(input: $input) {\n      id\n      role\n    }\n  }\n"): (typeof documents)["\n  mutation SignIn($input: SignInInput!) {\n    signIn(input: $input) {\n      id\n      role\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SignUp($input: SignUpInput!) {\n    signUp(input: $input) {\n      id\n      role\n    }\n  }\n"): (typeof documents)["\n  mutation SignUp($input: SignUpInput!) {\n    signUp(input: $input) {\n      id\n      role\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation HoldSlot($input: HoldSlotInput!) {\n    holdSlot(input: $input) {\n      id\n      holdExpiresAt\n    }\n  }\n"): (typeof documents)["\n  mutation HoldSlot($input: HoldSlotInput!) {\n    holdSlot(input: $input) {\n      id\n      holdExpiresAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ConfirmBooking($input: ConfirmBookingInput!) {\n    confirmBooking(input: $input) {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation ConfirmBooking($input: ConfirmBookingInput!) {\n    confirmBooking(input: $input) {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ReleaseHold($input: CancelInput!) {\n    cancelAppointment(input: $input) {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation ReleaseHold($input: CancelInput!) {\n    cancelAppointment(input: $input) {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription HoldWatch {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  subscription HoldWatch {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query HoldStatus {\n    myAppointments(scope: UPCOMING, limit: 30) {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  query HoldStatus {\n    myAppointments(scope: UPCOMING, limit: 30) {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CancelAppointment($input: CancelInput!) {\n    cancelAppointment(input: $input) {\n      id\n      status\n      cancelledLate\n    }\n  }\n"): (typeof documents)["\n  mutation CancelAppointment($input: CancelInput!) {\n    cancelAppointment(input: $input) {\n      id\n      status\n      cancelledLate\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RescheduleAppointment($input: RescheduleInput!) {\n    rescheduleAppointment(input: $input) {\n      id\n      startsAt\n      version\n    }\n  }\n"): (typeof documents)["\n  mutation RescheduleAppointment($input: RescheduleInput!) {\n    rescheduleAppointment(input: $input) {\n      id\n      startsAt\n      version\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SearchPatients($query: String!) {\n    searchPatients(query: $query) {\n      id\n      fullName\n      phone\n      onlineBookingBlockedUntil\n    }\n  }\n"): (typeof documents)["\n  query SearchPatients($query: String!) {\n    searchPatients(query: $query) {\n      id\n      fullName\n      phone\n      onlineBookingBlockedUntil\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RegistrarBook($input: RegistrarBookInput!) {\n    registrarBook(input: $input) {\n      id\n      status\n      startsAt\n    }\n  }\n"): (typeof documents)["\n  mutation RegistrarBook($input: RegistrarBookInput!) {\n    registrarBook(input: $input) {\n      id\n      status\n      startsAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetScheduleException($input: ExceptionInput!) {\n    setScheduleException(input: $input)\n  }\n"): (typeof documents)["\n  mutation SetScheduleException($input: ExceptionInput!) {\n    setScheduleException(input: $input)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MarkDoctorSick($input: MarkSickInput!) {\n    markDoctorSick(input: $input) {\n      cancelled\n      alreadyMarked\n    }\n  }\n"): (typeof documents)["\n  mutation MarkDoctorSick($input: MarkSickInput!) {\n    markDoctorSick(input: $input) {\n      cancelled\n      alreadyMarked\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveScheduleTemplate($input: RemoveTemplateInput!) {\n    removeScheduleTemplate(input: $input)\n  }\n"): (typeof documents)["\n  mutation RemoveScheduleTemplate($input: RemoveTemplateInput!) {\n    removeScheduleTemplate(input: $input)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveScheduleException($input: RemoveExceptionInput!) {\n    removeScheduleException(input: $input)\n  }\n"): (typeof documents)["\n  mutation RemoveScheduleException($input: RemoveExceptionInput!) {\n    removeScheduleException(input: $input)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetScheduleTemplate($input: TemplateInput!) {\n    setScheduleTemplate(input: $input)\n  }\n"): (typeof documents)["\n  mutation SetScheduleTemplate($input: TemplateInput!) {\n    setScheduleTemplate(input: $input)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation JoinWaitlist($input: JoinWaitlistInput!) {\n    joinWaitlist(input: $input) {\n      id\n      fromDate\n      toDate\n    }\n  }\n"): (typeof documents)["\n  mutation JoinWaitlist($input: JoinWaitlistInput!) {\n    joinWaitlist(input: $input) {\n      id\n      fromDate\n      toDate\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyWaitlist {\n    myWaitlist {\n      id\n      fromDate\n      toDate\n      priority\n      doctor {\n        fullName\n      }\n      service {\n        nameUk\n        nameEn\n        namePl\n      }\n    }\n  }\n"): (typeof documents)["\n  query MyWaitlist {\n    myWaitlist {\n      id\n      fromDate\n      toDate\n      priority\n      doctor {\n        fullName\n      }\n      service {\n        nameUk\n        nameEn\n        namePl\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation LeaveWaitlist($id: ID!) {\n    leaveWaitlist(id: $id)\n  }\n"): (typeof documents)["\n  mutation LeaveWaitlist($id: ID!) {\n    leaveWaitlist(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyOffers {\n    myOffers {\n      id\n      expiresAt\n      appointment {\n        id\n        startsAt\n        clinic {\n          timeZone\n        }\n        doctor {\n          fullName\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query MyOffers {\n    myOffers {\n      id\n      expiresAt\n      appointment {\n        id\n        startsAt\n        clinic {\n          timeZone\n        }\n        doctor {\n          fullName\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription OfferWatch {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  subscription OfferWatch {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AcceptOffer($input: RespondOfferInput!) {\n    acceptOffer(input: $input) {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation AcceptOffer($input: RespondOfferInput!) {\n    acceptOffer(input: $input) {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeclineOffer($id: ID!) {\n    declineOffer(id: $id)\n  }\n"): (typeof documents)["\n  mutation DeclineOffer($id: ID!) {\n    declineOffer(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyNotifications {\n    myNotifications(limit: 10) {\n      id\n      kind\n      createdAt\n      readAt\n    }\n  }\n"): (typeof documents)["\n  query MyNotifications {\n    myNotifications(limit: 10) {\n      id\n      kind\n      createdAt\n      readAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query DoctorWeek($from: String!) {\n    doctorSchedule(fromDate: $from, days: 7) {\n      ...AppointmentFields\n    }\n  }\n"): (typeof documents)["\n  query DoctorWeek($from: String!) {\n    doctorSchedule(fromDate: $from, days: 7) {\n      ...AppointmentFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription DoctorChanged {\n    doctorAppointmentChanged {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  subscription DoctorChanged {\n    doctorAppointmentChanged {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyAppointments($scope: VisitScope!) {\n    myAppointments(scope: $scope, limit: 30) {\n      ...AppointmentFields\n    }\n  }\n"): (typeof documents)["\n  query MyAppointments($scope: VisitScope!) {\n    myAppointments(scope: $scope, limit: 30) {\n      ...AppointmentFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription MyAppointmentsChanged {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  subscription MyAppointmentsChanged {\n    myAppointmentChanged {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ClinicBoard($clinicId: ID!, $date: String!) {\n    clinicBoard(clinicId: $clinicId, date: $date) {\n      ...AppointmentFields\n    }\n  }\n"): (typeof documents)["\n  query ClinicBoard($clinicId: ID!, $date: String!) {\n    clinicBoard(clinicId: $clinicId, date: $date) {\n      ...AppointmentFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription BoardChanged($clinicId: ID!) {\n    clinicAppointmentChanged(clinicId: $clinicId) {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  subscription BoardChanged($clinicId: ID!) {\n    clinicAppointmentChanged(clinicId: $clinicId) {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Report($from: String!, $to: String!, $clinicId: ID) {\n    report(from: $from, to: $to, clinicId: $clinicId) {\n      from\n      to\n      utilization {\n        doctorId\n        doctorName\n        clinicId\n        workMinutes\n        bookedMinutes\n        percent\n      }\n      rates {\n        bookings\n        noShows\n        lateCancels\n        noShowPercent\n        lateCancelPercent\n      }\n      waitlist {\n        offered\n        accepted\n        acceptedPercent\n      }\n      revenue {\n        serviceId\n        serviceCode\n        nameUk\n        nameEn\n        namePl\n        currency\n        revenueMinor\n        visits\n      }\n    }\n  }\n"): (typeof documents)["\n  query Report($from: String!, $to: String!, $clinicId: ID) {\n    report(from: $from, to: $to, clinicId: $clinicId) {\n      from\n      to\n      utilization {\n        doctorId\n        doctorName\n        clinicId\n        workMinutes\n        bookedMinutes\n        percent\n      }\n      rates {\n        bookings\n        noShows\n        lateCancels\n        noShowPercent\n        lateCancelPercent\n      }\n      waitlist {\n        offered\n        accepted\n        acceptedPercent\n      }\n      revenue {\n        serviceId\n        serviceCode\n        nameUk\n        nameEn\n        namePl\n        currency\n        revenueMinor\n        visits\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query DoctorWeeklySchedule($doctorId: ID!) {\n    doctorWeeklySchedule(doctorId: $doctorId) {\n      doctorId\n      templates {\n        doctorId\n        clinicId\n        weekday\n        startLocal\n        endLocal\n        breakStartLocal\n        breakEndLocal\n      }\n      exceptions {\n        doctorId\n        localDate\n        kind\n        clinicId\n        startLocal\n        endLocal\n      }\n    }\n  }\n"): (typeof documents)["\n  query DoctorWeeklySchedule($doctorId: ID!) {\n    doctorWeeklySchedule(doctorId: $doctorId) {\n      doctorId\n      templates {\n        doctorId\n        clinicId\n        weekday\n        startLocal\n        endLocal\n        breakStartLocal\n        breakEndLocal\n      }\n      exceptions {\n        doctorId\n        localDate\n        kind\n        clinicId\n        startLocal\n        endLocal\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;