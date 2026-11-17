export type ServiceDef = {
  code: string;
  specialty: string;
  nameUk: string;
  nameEn: string;
  namePl: string;
  durationMin: number;
  needsUltrasound: boolean;
  /** Price in major units of UAH; PLN price is derived. */
  priceUah: number;
  weight: number;
};

/** 15 services over 6 specialties; 3 of them need the clinic's ultrasound room. */
export const SERVICES: readonly ServiceDef[] = [
  { code: 'therapy-consult', specialty: 'therapy', nameUk: 'Консультація терапевта', nameEn: 'Therapist consultation', namePl: 'Konsultacja terapeuty', durationMin: 30, needsUltrasound: false, priceUah: 700, weight: 10 },
  { code: 'therapy-followup', specialty: 'therapy', nameUk: 'Повторний прийом терапевта', nameEn: 'Therapist follow-up', namePl: 'Wizyta kontrolna terapeuty', durationMin: 15, needsUltrasound: false, priceUah: 400, weight: 10 },
  { code: 'therapy-uzi', specialty: 'therapy', nameUk: 'УЗД органів черевної порожнини', nameEn: 'Abdominal ultrasound', namePl: 'USG jamy brzusznej', durationMin: 30, needsUltrasound: true, priceUah: 1200, weight: 4 },
  { code: 'cardio-consult', specialty: 'cardiology', nameUk: 'Консультація кардіолога', nameEn: 'Cardiologist consultation', namePl: 'Konsultacja kardiologa', durationMin: 30, needsUltrasound: false, priceUah: 900, weight: 8 },
  { code: 'cardio-ecg', specialty: 'cardiology', nameUk: 'ЕКГ', nameEn: 'ECG', namePl: 'EKG', durationMin: 15, needsUltrasound: false, priceUah: 500, weight: 8 },
  { code: 'cardio-echo', specialty: 'cardiology', nameUk: 'УЗД серця', nameEn: 'Heart ultrasound', namePl: 'USG serca', durationMin: 45, needsUltrasound: true, priceUah: 1800, weight: 3 },
  { code: 'gyn-consult', specialty: 'gynecology', nameUk: 'Консультація гінеколога', nameEn: 'Gynecologist consultation', namePl: 'Konsultacja ginekologa', durationMin: 30, needsUltrasound: false, priceUah: 850, weight: 8 },
  { code: 'gyn-uzi', specialty: 'gynecology', nameUk: 'УЗД органів малого тазу', nameEn: 'Pelvic ultrasound', namePl: 'USG miednicy', durationMin: 30, needsUltrasound: true, priceUah: 1100, weight: 5 },
  { code: 'gyn-smear', specialty: 'gynecology', nameUk: 'Мазок', nameEn: 'Smear test', namePl: 'Cytologia', durationMin: 15, needsUltrasound: false, priceUah: 450, weight: 5 },
  { code: 'ped-consult', specialty: 'pediatrics', nameUk: 'Консультація педіатра', nameEn: 'Pediatrician consultation', namePl: 'Konsultacja pediatry', durationMin: 30, needsUltrasound: false, priceUah: 750, weight: 8 },
  { code: 'ped-vaccine', specialty: 'pediatrics', nameUk: 'Вакцинація', nameEn: 'Vaccination', namePl: 'Szczepienie', durationMin: 15, needsUltrasound: false, priceUah: 350, weight: 8 },
  { code: 'derm-consult', specialty: 'dermatology', nameUk: 'Консультація дерматолога', nameEn: 'Dermatologist consultation', namePl: 'Konsultacja dermatologa', durationMin: 30, needsUltrasound: false, priceUah: 800, weight: 8 },
  { code: 'derm-scope', specialty: 'dermatology', nameUk: 'Дерматоскопія', nameEn: 'Dermatoscopy', namePl: 'Dermatoskopia', durationMin: 15, needsUltrasound: false, priceUah: 600, weight: 8 },
  { code: 'neuro-consult', specialty: 'neurology', nameUk: 'Консультація невролога', nameEn: 'Neurologist consultation', namePl: 'Konsultacja neurologa', durationMin: 45, needsUltrasound: false, priceUah: 950, weight: 6 },
  { code: 'neuro-eeg', specialty: 'neurology', nameUk: 'ЕЕГ', nameEn: 'EEG', namePl: 'EEG', durationMin: 60, needsUltrasound: false, priceUah: 1700, weight: 2 },
];

export const SPECIALTIES = ['therapy', 'cardiology', 'gynecology', 'pediatrics', 'dermatology', 'neurology'] as const;

export const FIRST_UK = ['Олена', 'Іван', 'Марія', 'Андрій', 'Наталія', 'Олександр', 'Юлія', 'Сергій', 'Катерина', 'Дмитро', 'Оксана', 'Василь', 'Тетяна', 'Богдан', 'Ірина', 'Тарас'];
export const LAST_UK = ['Шевченко', 'Коваленко', 'Бондаренко', 'Мельник', 'Ткаченко', 'Кравчук', 'Олійник', 'Поліщук', 'Лисенко', 'Мороз', 'Савченко', 'Руденко', 'Гриценко', 'Петренко', 'Клименко', 'Бойко'];
export const FIRST_PL = ['Anna', 'Piotr', 'Katarzyna', 'Michał', 'Agnieszka', 'Tomasz', 'Magdalena', 'Paweł', 'Ewa', 'Krzysztof', 'Joanna', 'Marcin'];
export const LAST_PL = ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski'];

/** PLN price = UAH price ÷ 10, rounded to whole zł, in grosze. */
export const pricePln = (uah: number): number => Math.max(1, Math.round(uah / 10)) * 100;
