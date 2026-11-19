/**
 * OFFICIAL SYLLABUS TOPICS, taken verbatim from the student's uploaded course outline.
 *
 * Headings are preserved exactly as written in the outline; MEDTRACK never invents official topics.
 * The outline document had not been supplied when this file was created, so every list is empty and
 * every course starts at 0 tracked topics (0% — honestly "not yet defined", not "completed").
 *
 * To populate: either paste the outline into a course page ("Import outline"), or fill this map and
 * a NEW account will be seeded with these topics. Nested topics use `children`.
 */
export interface OutlineTopic {
  title: string;
  children?: OutlineTopic[];
}

export const OFFICIAL_OUTLINE: Record<string, OutlineTopic[]> = {
  'ANA 201a': [],
  'ANA 201b': [],
  'ANA 203': [],
  'ANA 205': [],
  'PHS 201': [],
  'PHS 203': [],
  'PHS 205': [],
  'BCH 201': [],
  'BCH 203': [],
  'BCH 205': [],
  'BCH 209': [],
};
