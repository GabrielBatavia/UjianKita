export type AuditAction =
  | "auth.login_success"
  | "auth.login_failed"
  | "auth.login_rate_limited"
  | "auth.logout"
  | "auth.password_reset_requested"
  | "student.created"
  | "student.updated"
  | "student.status_changed"
  | "teacher.created"
  | "teacher.updated"
  | "teacher.status_changed"
  | "teacher.assigned"
  | "teacher.unassigned"
  | "class.created"
  | "class.updated"
  | "academic_year.created"
  | "academic_year.activated"
  | "subject.created"
  | "subject.updated"
  | "school.settings_updated"
  | "security.unauthorized_access_attempt"
  | "question.created"
  | "question.version_created"
  | "question.duplicated"
  | "question.archived"
  | "question.bulk_imported"
  | "exam.created"
  | "exam.updated"
  | "exam.questions_updated"
  | "exam.scheduled"
  | "exam.validated"
  | "exam.published"
  | "exam.revision_started"
  | "exam.closed"
  | "exam.archived"
  | "exam.admin_closed"
  | "exam.admin_archived"
  | "attempt.started"
  | "attempt.resumed"
  | "attempt.submitted"
  | "attempt.expired"
  | "attempt.cancelled"
  | "grading.essay_saved"
  | "grading.finalized"
  | "grading.adjusted"
  | "results.released"
  | "results.unpublished";

export interface AuditEventInput {
  schoolId: string;
  actorUserId: string | null;
  actorRole: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEventRecord {
  id: string;
  school_id: string;
  actor_user_id: string | null;
  actor_role: string;
  actor_name?: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}
