export type TableName =
  | 'profiles'
  | 'courses'
  | 'syllabus_topics'
  | 'cycle_templates'
  | 'cycle_days'
  | 'reading_sessions'
  | 'study_records'
  | 'session_topic_logs'
  | 'daily_accountability'
  | 'notification_preferences'
  | 'sync_metadata';

/** Tables in foreign-key dependency order (parents first). Used for push ordering. */
export const TABLES: TableName[] = [
  'profiles',
  'notification_preferences',
  'courses',
  'syllabus_topics',
  'cycle_templates',
  'cycle_days',
  'reading_sessions',
  'study_records',
  'session_topic_logs',
  'daily_accountability',
  'sync_metadata',
];

export interface BaseRow {
  id: string;
  user_id: string;
  /** Server-assigned version. 0 = never synced to the server. */
  version: number;
  created_at: string;
  updated_at: string;
  client_updated_at: string;
  deleted_at: string | null;
}

export type TopicStatus = 'not_started' | 'in_progress' | 'completed';
export type SessionStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'missed';
export type Slot = 'primary' | 'secondary';

export interface Profile extends BaseRow {
  display_name: string;
  timezone: string;
  primary_time: string;
  primary_minutes: number;
  secondary_time: string;
  secondary_minutes: number;
  accountability_time: string;
}
export interface Course extends BaseRow {
  code: string;
  title: string;
  units: number;
  department: string;
  position: number;
  included: boolean;
}
export interface Topic extends BaseRow {
  course_id: string;
  parent_id: string | null;
  title: string;
  is_official: boolean;
  status: TopicStatus;
  notes: string;
  page_ref: string;
  position: number;
}
export interface CycleTemplate extends BaseRow {
  day_number: number;
  primary_course_id: string;
  secondary_course_id: string;
}
export interface CycleDay extends BaseRow {
  cycle_number: number;
  day_number: number;
  opened_on: string;
  status: 'open' | 'closed';
  close_reason: 'completed' | 'reviewed' | null;
  closed_at: string | null;
  review_note: string;
}
export interface ReadingSession extends BaseRow {
  cycle_day_id: string;
  slot: Slot;
  course_id: string;
  planned_start: string;
  planned_minutes: number;
  status: SessionStatus;
}
export interface StudyRecord extends BaseRow {
  session_id: string;
  actual_seconds: number;
  study_date: string;
  timer_running_since: string | null;
  timer_accumulated_seconds: number;
  pages: string;
  slides: string;
  reflection: string;
}
export interface TopicLog extends BaseRow {
  session_id: string;
  topic_id: string;
  topic_title: string;
  course_id: string;
  status_after: TopicStatus;
  confidence: number | null;
  minutes: number;
  pages: string;
  notes: string;
}
export interface Accountability extends BaseRow {
  check_date: string;
  followed_plan: 'yes' | 'partly' | 'no';
  biggest_obstacle: string;
  tomorrow_commitment: string;
}
export interface NotificationPrefs extends BaseRow {
  primary_reminder: boolean;
  secondary_reminder: boolean;
  accountability_reminder: boolean;
  overdue_reminder: boolean;
  overdue_after_minutes: number;
  incomplete_reminder: boolean;
  unrecorded_reminder: boolean;
}
export interface SyncMeta extends BaseRow {
  device_id: string;
  device_label: string;
  last_synced_at: string | null;
}

export interface RowMap {
  profiles: Profile;
  courses: Course;
  syllabus_topics: Topic;
  cycle_templates: CycleTemplate;
  cycle_days: CycleDay;
  reading_sessions: ReadingSession;
  study_records: StudyRecord;
  session_topic_logs: TopicLog;
  daily_accountability: Accountability;
  notification_preferences: NotificationPrefs;
  sync_metadata: SyncMeta;
}
export type AnyRow = RowMap[TableName];
