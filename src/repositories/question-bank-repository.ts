import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  QuestionAttachmentPlaceholder,
  QuestionBankRecord,
  QuestionDifficulty,
  QuestionOptionItem,
  QuestionRecord,
  QuestionStatus,
  QuestionType,
  QuestionVersionRecord,
  ScoringPolicy,
} from "@/domain/exams/phase2-types";

interface RawVersionRow {
  id: string;
  question_id: string;
  version_number: number;
  stem: string;
  explanation: string | null;
  points: number | string;
  scoring_policy: ScoringPolicy;
  rubric_notes: string | null;
  preserve_option_order: boolean;
  created_by: string | null;
  created_at: string;
  options?: Array<{
    option_key: string;
    option_text: string;
    display_order: number;
  }> | null;
  answer_key?:
    | { correct_option_keys?: string[] | null }
    | Array<{ correct_option_keys?: string[] | null }>
    | null;
  author?: { full_name?: string } | Array<{ full_name?: string }> | null;
}

interface RawQuestionRow {
  id: string;
  school_id: string;
  question_bank_id: string;
  subject_id: string;
  created_by: string | null;
  current_version_id: string | null;
  question_type: QuestionType;
  difficulty: QuestionDifficulty;
  topic: string | null;
  tags: string[] | null;
  status: QuestionStatus;
  attachment_metadata: QuestionAttachmentPlaceholder[] | null;
  content_fingerprint: string;
  created_at: string;
  updated_at: string;
  subject?: { code?: string; name?: string } | Array<{ code?: string; name?: string }> | null;
  author?: { full_name?: string } | Array<{ full_name?: string }> | null;
  current_version?: RawVersionRow | RawVersionRow[] | null;
}

function mapVersionRow(raw: RawVersionRow): QuestionVersionRecord {
  const answerKeyRel = Array.isArray(raw.answer_key) ? raw.answer_key[0] : raw.answer_key;
  const authorRel = Array.isArray(raw.author) ? raw.author[0] : raw.author;
  const options: QuestionOptionItem[] = (raw.options ?? [])
    .map((o) => ({
      optionKey: o.option_key,
      optionText: o.option_text,
      displayOrder: o.display_order,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return {
    id: raw.id,
    question_id: raw.question_id,
    version_number: raw.version_number,
    stem: raw.stem,
    explanation: raw.explanation ?? null,
    points: Number(raw.points),
    scoring_policy: raw.scoring_policy,
    rubric_notes: raw.rubric_notes ?? null,
    preserve_option_order: Boolean(raw.preserve_option_order),
    created_by: raw.created_by ?? null,
    created_by_name: authorRel?.full_name ?? null,
    created_at: raw.created_at,
    options,
    correct_option_keys: answerKeyRel?.correct_option_keys ?? [],
  };
}

export function mapQuestionRow(raw: RawQuestionRow): QuestionRecord {
  const subjectRel = Array.isArray(raw.subject) ? raw.subject[0] : raw.subject;
  const authorRel = Array.isArray(raw.author) ? raw.author[0] : raw.author;
  const versionRel = Array.isArray(raw.current_version)
    ? raw.current_version[0]
    : raw.current_version;

  return {
    id: raw.id,
    school_id: raw.school_id,
    question_bank_id: raw.question_bank_id,
    subject_id: raw.subject_id,
    subject_code: subjectRel?.code,
    subject_name: subjectRel?.name,
    created_by: raw.created_by ?? null,
    created_by_name: authorRel?.full_name ?? null,
    current_version_id: raw.current_version_id ?? null,
    question_type: raw.question_type,
    difficulty: raw.difficulty,
    topic: raw.topic ?? null,
    tags: raw.tags ?? [],
    status: raw.status,
    attachment_metadata: Array.isArray(raw.attachment_metadata) ? raw.attachment_metadata : [],
    content_fingerprint: raw.content_fingerprint,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    current_version: versionRel ? mapVersionRow(versionRel) : null,
  };
}

export async function ensureDefaultQuestionBank(
  supabase: SupabaseClient,
  schoolId: string,
  subjectId: string,
  createdBy: string
): Promise<QuestionBankRecord> {
  const { data: existing, error: findErr } = await supabase
    .from("question_banks")
    .select("*")
    .eq("school_id", schoolId)
    .eq("subject_id", subjectId)
    .eq("is_archived", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findErr) {
    throw new Error(`Gagal memeriksa bank soal: ${findErr.message}`);
  }
  if (existing) {
    return existing as QuestionBankRecord;
  }

  const { data: subjectRow } = await supabase
    .from("subjects")
    .select("name, code")
    .eq("id", subjectId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const title = subjectRow
    ? `Bank Soal ${subjectRow.name as string} (${subjectRow.code as string})`
    : "Bank Soal Utama";

  const { data: created, error: createErr } = await supabase
    .from("question_banks")
    .insert({
      school_id: schoolId,
      subject_id: subjectId,
      created_by: createdBy,
      title,
      description: "Bank soal utama mata pelajaran",
    })
    .select("*")
    .single();

  if (createErr || !created) {
    throw new Error(`Gagal membuat bank soal default: ${createErr?.message ?? "unknown"}`);
  }

  return created as QuestionBankRecord;
}

export async function fetchQuestionBanks(
  supabase: SupabaseClient,
  schoolId: string
): Promise<QuestionBankRecord[]> {
  const { data, error } = await supabase
    .from("question_banks")
    .select(
      `
      *,
      subject:subject_id ( code, name )
    `
    )
    .eq("school_id", schoolId)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Gagal memuat daftar bank soal: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const subj = Array.isArray(row.subject) ? row.subject[0] : row.subject;
    return {
      ...(row as Omit<QuestionBankRecord, "subject_code" | "subject_name">),
      subject_code: (subj as { code?: string } | null)?.code,
      subject_name: (subj as { name?: string } | null)?.name,
    };
  });
}

export interface QuestionListFilter {
  schoolId: string;
  subjectId?: string;
  questionType?: QuestionType;
  difficulty?: QuestionDifficulty;
  status?: QuestionStatus | "all_non_archived";
  search?: string;
  tag?: string;
  page: number;
  pageSize: number;
}

export async function fetchPaginatedQuestions(
  supabase: SupabaseClient,
  filter: QuestionListFilter
): Promise<{ questions: QuestionRecord[]; total: number }> {
  const from = Math.max(0, (filter.page - 1) * filter.pageSize);
  const to = from + filter.pageSize - 1;

  let query = supabase
    .from("questions")
    .select(
      `
      id,
      school_id,
      question_bank_id,
      subject_id,
      created_by,
      current_version_id,
      question_type,
      difficulty,
      topic,
      tags,
      status,
      attachment_metadata,
      content_fingerprint,
      created_at,
      updated_at,
      subject:subject_id ( code, name ),
      author:created_by ( full_name ),
      current_version:current_version_id (
        id,
        question_id,
        version_number,
        stem,
        explanation,
        points,
        scoring_policy,
        rubric_notes,
        preserve_option_order,
        created_by,
        created_at,
        options:question_options ( option_key, option_text, display_order ),
        answer_key:question_answer_keys ( correct_option_keys )
      )
    `,
      { count: "exact" }
    )
    .eq("school_id", filter.schoolId);

  if (filter.subjectId) {
    query = query.eq("subject_id", filter.subjectId);
  }
  if (filter.questionType) {
    query = query.eq("question_type", filter.questionType);
  }
  if (filter.difficulty) {
    query = query.eq("difficulty", filter.difficulty);
  }
  if (filter.status === "all_non_archived") {
    query = query.neq("status", "archived");
  } else if (filter.status) {
    query = query.eq("status", filter.status);
  }
  if (filter.tag) {
    query = query.contains("tags", [filter.tag]);
  }
  if (filter.search?.trim()) {
    const clean = filter.search.trim().replace(/[%_]/g, "");
    if (clean) {
      query = query.or(`topic.ilike.%${clean}%`);
    }
  }

  const { data, count, error } = await query
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error(`Gagal memuat daftar soal: ${error.message}`);
  }

  let mapped = ((data ?? []) as RawQuestionRow[]).map(mapQuestionRow);

  // If user searched by text inside stem (stored in current_version), apply clean filter
  if (filter.search?.trim()) {
    const qLower = filter.search.trim().toLowerCase();
    mapped = mapped.filter(
      (item) =>
        (item.topic ?? "").toLowerCase().includes(qLower) ||
        (item.current_version?.stem ?? "").toLowerCase().includes(qLower) ||
        item.tags.some((t) => t.toLowerCase().includes(qLower))
    );
  }

  return {
    questions: mapped,
    total: filter.search?.trim() ? mapped.length : (count ?? mapped.length),
  };
}

export async function fetchQuestionDetail(
  supabase: SupabaseClient,
  schoolId: string,
  questionId: string
): Promise<{ question: QuestionRecord; versions: QuestionVersionRecord[] } | null> {
  const { data: qRow, error: qErr } = await supabase
    .from("questions")
    .select(
      `
      id,
      school_id,
      question_bank_id,
      subject_id,
      created_by,
      current_version_id,
      question_type,
      difficulty,
      topic,
      tags,
      status,
      attachment_metadata,
      content_fingerprint,
      created_at,
      updated_at,
      subject:subject_id ( code, name ),
      author:created_by ( full_name ),
      current_version:current_version_id (
        id,
        question_id,
        version_number,
        stem,
        explanation,
        points,
        scoring_policy,
        rubric_notes,
        preserve_option_order,
        created_by,
        created_at,
        options:question_options ( option_key, option_text, display_order ),
        answer_key:question_answer_keys ( correct_option_keys )
      )
    `
    )
    .eq("id", questionId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (qErr) {
    throw new Error(`Gagal memuat detail soal: ${qErr.message}`);
  }
  if (!qRow) return null;

  const { data: verRows, error: verErr } = await supabase
    .from("question_versions")
    .select(
      `
      id,
      question_id,
      version_number,
      stem,
      explanation,
      points,
      scoring_policy,
      rubric_notes,
      preserve_option_order,
      created_by,
      created_at,
      author:created_by ( full_name ),
      options:question_options ( option_key, option_text, display_order ),
      answer_key:question_answer_keys ( correct_option_keys )
    `
    )
    .eq("question_id", questionId)
    .order("version_number", { ascending: false });

  if (verErr) {
    throw new Error(`Gagal memuat riwayat revisi soal: ${verErr.message}`);
  }

  return {
    question: mapQuestionRow(qRow as RawQuestionRow),
    versions: ((verRows ?? []) as RawVersionRow[]).map(mapVersionRow),
  };
}

export async function fetchExistingFingerprints(
  supabase: SupabaseClient,
  schoolId: string,
  subjectId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("questions")
    .select("content_fingerprint")
    .eq("school_id", schoolId)
    .eq("subject_id", subjectId)
    .neq("status", "archived");

  if (error) {
    throw new Error(`Gagal memeriksa duplikasi bank soal: ${error.message}`);
  }

  return new Set((data ?? []).map((r) => r.content_fingerprint as string));
}
