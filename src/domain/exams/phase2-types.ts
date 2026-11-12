export type QuestionType = "single_choice" | "multiple_choice" | "true_false" | "essay";

export type QuestionDifficulty = "easy" | "medium" | "hard";

export type QuestionStatus = "draft" | "active" | "archived";

export type ScoringPolicy = "exact_match" | "partial_credit_disabled" | "manual_rubric";

export type ExamStatus = "DRAFT" | "READY_FOR_REVIEW" | "PUBLISHED" | "CLOSED" | "ARCHIVED";

export type ResultReleasePolicy = "manual" | "after_submit_if_no_essay" | "after_window_close";

export interface QuestionOptionItem {
  optionKey: string;
  optionText: string;
  displayOrder: number;
}

export interface QuestionAttachmentPlaceholder {
  id: string;
  label: string;
  altText: string;
  storageReady: false;
  note: string;
}

export interface QuestionBankRecord {
  id: string;
  school_id: string;
  subject_id: string;
  subject_code?: string;
  subject_name?: string;
  created_by: string | null;
  title: string;
  description: string | null;
  is_archived: boolean;
  question_count?: number;
  created_at: string;
  updated_at: string;
}

export interface QuestionVersionRecord {
  id: string;
  question_id: string;
  version_number: number;
  stem: string;
  explanation: string | null;
  points: number;
  scoring_policy: ScoringPolicy;
  rubric_notes: string | null;
  preserve_option_order: boolean;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
  options: QuestionOptionItem[];
  correct_option_keys: string[];
}

export interface QuestionRecord {
  id: string;
  school_id: string;
  question_bank_id: string;
  subject_id: string;
  subject_code?: string;
  subject_name?: string;
  created_by: string | null;
  created_by_name?: string | null;
  current_version_id: string | null;
  question_type: QuestionType;
  difficulty: QuestionDifficulty;
  topic: string | null;
  tags: string[];
  status: QuestionStatus;
  attachment_metadata: QuestionAttachmentPlaceholder[];
  content_fingerprint: string;
  created_at: string;
  updated_at: string;
  current_version: QuestionVersionRecord | null;
}

export interface ExamRecord {
  id: string;
  school_id: string;
  subject_id: string;
  subject_code?: string;
  subject_name?: string;
  academic_year_id: string;
  academic_year_name?: string;
  academic_year_semester?: string;
  created_by: string | null;
  created_by_name?: string | null;
  title: string;
  description: string | null;
  instructions: string | null;
  status: ExamStatus;
  duration_minutes: number;
  max_attempts: number;
  passing_score: number;
  randomize_questions: boolean;
  randomize_options: boolean;
  starts_at: string | null;
  ends_at: string | null;
  published_version_id: string | null;
  version_lock: number;
  result_release_policy?: ResultReleasePolicy;
  results_released_at?: string | null;
  results_released_by?: string | null;
  allow_student_review?: boolean;
  question_count?: number;
  total_points?: number;
  assigned_class_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ExamDraftQuestionItem {
  id: string;
  exam_id: string;
  question_id: string;
  display_order: number;
  points_override: number | null;
  preserve_order: boolean;
  question: QuestionRecord;
}

export interface ExamClassAssignmentItem {
  id: string;
  exam_id: string;
  class_id: string;
  class_name: string;
  grade_level: string;
  student_count: number;
}

export interface ExamScheduleItem {
  id: string;
  exam_id: string;
  exam_title?: string;
  exam_status?: ExamStatus;
  subject_name?: string;
  class_id: string;
  class_name: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  max_attempts: number;
  late_join_minutes: number;
  require_exam_browser: boolean;
}

export interface ExamVersionSummary {
  id: string;
  exam_id: string;
  version_number: number;
  title: string;
  duration_minutes: number;
  max_attempts: number;
  total_points: number;
  passing_score: number;
  randomize_questions: boolean;
  randomize_options: boolean;
  starts_at: string;
  ends_at: string;
  snapshot_hash: string;
  published_by: string | null;
  published_by_name?: string | null;
  published_at: string;
  question_count?: number;
}

export interface ExamPublicationEventItem {
  id: string;
  exam_id: string;
  exam_version_id: string | null;
  event_type:
    | "VALIDATED"
    | "PUBLISHED"
    | "CLOSED"
    | "ARCHIVED"
    | "REVISION_STARTED"
    | "ADMIN_CLOSED"
    | "ADMIN_ARCHIVED";
  actor_user_id: string | null;
  actor_name?: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Student-facing preview payload strictly excludes answer keys, explanations,
 * and teacher-only scoring rubrics.
 */
export interface StudentPreviewQuestion {
  index: number;
  questionId: string;
  questionType: QuestionType;
  stem: string;
  points: number;
  options: Array<{
    optionKey: string;
    optionText: string;
    displayOrder: number;
  }>;
}

export interface StudentExamPreviewPayload {
  examId: string;
  source: "draft" | "published_snapshot";
  versionNumber: number | null;
  title: string;
  subjectName: string;
  instructions: string | null;
  durationMinutes: number;
  totalQuestions: number;
  totalPoints: number;
  questions: StudentPreviewQuestion[];
}

export interface TeacherReviewPreviewQuestion extends StudentPreviewQuestion {
  correctOptionKeys: string[];
  explanation: string | null;
  scoringPolicy: ScoringPolicy;
  rubricNotes: string | null;
}

export interface TeacherExamReviewPayload {
  examId: string;
  source: "draft" | "published_snapshot";
  versionNumber: number | null;
  title: string;
  subjectName: string;
  instructions: string | null;
  durationMinutes: number;
  passingScore: number;
  totalQuestions: number;
  totalPoints: number;
  questions: TeacherReviewPreviewQuestion[];
}
