'use client';

import { useQuery } from 'urql';
import { graphql } from '@/shared/api';

const ClinicsDocument = graphql(`query Clinics { clinics { id city timeZone currency } }`);
const ClinicServicesDocument = graphql(`
  query ClinicServices($clinicId: ID!) {
    clinicServices(clinicId: $clinicId) { priceMinor currency service { id code specialty nameUk nameEn namePl durationMin needsUltrasound } }
  }
`);
const ClinicDoctorsDocument = graphql(`
  query ClinicDoctors($clinicId: ID!, $serviceId: ID) {
    clinicDoctors(clinicId: $clinicId, serviceId: $serviceId) { id fullName specialty }
  }
`);

export const useClinics = () => {
  const [{ data, fetching }] = useQuery({ query: ClinicsDocument });
  return { clinics: data?.clinics ?? [], fetching };
};
export const useClinicServices = (clinicId: string) => {
  const [{ data, fetching }] = useQuery({ query: ClinicServicesDocument, variables: { clinicId }, pause: !clinicId });
  return { services: data?.clinicServices ?? [], fetching };
};
export const useClinicDoctors = (clinicId: string, serviceId?: string) => {
  const [{ data, fetching }] = useQuery({ query: ClinicDoctorsDocument, variables: { clinicId, serviceId: serviceId || null }, pause: !clinicId });
  return { doctors: data?.clinicDoctors ?? [], fetching };
};
