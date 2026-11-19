/**
 * Initial configuration used ONCE to seed a new account. After seeding, all of this lives in the
 * database and is editable (courses, timetable, session times) — nothing below is read at runtime.
 */
export interface SeedCourse {
  code: string;
  title: string;
  units: number;
  department: string;
}

export const SEED_COURSES: SeedCourse[] = [
  { code: 'ANA 201a', title: 'Introductory Anatomy and Gross Anatomy of Upper Limbs', units: 4, department: 'Anatomy' },
  { code: 'ANA 201b', title: 'Introductory Anatomy and Gross Anatomy of Lower Limbs', units: 4, department: 'Anatomy' },
  { code: 'ANA 203', title: 'Histology of Basic Tissues', units: 2, department: 'Anatomy' },
  { code: 'ANA 205', title: 'General Embryology', units: 2, department: 'Anatomy' },
  { code: 'PHS 201', title: 'Introductory Physiology and ANS', units: 2, department: 'Physiology' },
  { code: 'PHS 203', title: 'Blood Physiology', units: 2, department: 'Physiology' },
  { code: 'PHS 205', title: 'The Cardiovascular System', units: 2, department: 'Physiology' },
  { code: 'BCH 201', title: 'Cell Biology, pH and Buffer', units: 2, department: 'Biochemistry' },
  { code: 'BCH 203', title: 'Carbohydrate Chemistry', units: 2, department: 'Biochemistry' },
  { code: 'BCH 205', title: 'Amino Acids Chemistry', units: 2, department: 'Biochemistry' },
  { code: 'BCH 209', title: 'Lipid Metabolism', units: 2, department: 'Biochemistry' },
];

/** Approved 11-day timetable: [primary, secondary] by cycle day (index 0 = Day 1). */
export const SEED_TIMETABLE: Array<[string, string]> = [
  ['ANA 201a', 'BCH 201'],
  ['ANA 201b', 'PHS 201'],
  ['BCH 201', 'ANA 203'],
  ['ANA 201a', 'PHS 203'],
  ['PHS 205', 'BCH 203'],
  ['ANA 201b', 'ANA 205'],
  ['BCH 203', 'BCH 205'],
  ['BCH 205', 'PHS 205'],
  ['BCH 209', 'PHS 201'],
  ['PHS 203', 'BCH 209'],
  ['PHS 201', 'BCH 201'],
];

export const DEFAULT_SCHEDULE = {
  primary_time: '09:00',
  primary_minutes: 180,
  secondary_time: '16:00',
  secondary_minutes: 120,
  accountability_time: '18:00',
};
