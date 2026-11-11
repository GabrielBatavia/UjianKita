import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionEditor } from "@/components/features/teacher/question-editor";
import { ExamPreviewClient } from "@/components/features/teacher/exam-preview-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const SUBJECTS = [{ id: "11111111-1111-4111-8111-111111111111", code: "MAT-10", name: "Matematika" }];

describe("Phase 2 Teacher UI Components", () => {
  it("QuestionEditor supports switching types to essay and prevents invalid submissions", () => {
    render(<QuestionEditor mode="create" authorizedSubjects={SUBJECTS} />);

    fireEvent.change(screen.getByLabelText(/Tipe Soal/i), { target: { value: "essay" } });
    expect(screen.getByText(/Rubrik Penilaian Esai/i)).toBeInTheDocument();

    // Switch back to single_choice and submit empty stem
    fireEvent.change(screen.getByLabelText(/Tipe Soal/i), { target: { value: "single_choice" } });
    fireEvent.change(screen.getByLabelText(/Teks Pertanyaan/i), { target: { value: "ab" } });
    fireEvent.submit(screen.getByRole("button", { name: /Simpan Soal/i }).closest("form")!);

    expect(screen.getByText(/minimal 3 karakter/i)).toBeInTheDocument();
  });

  it("ExamPreviewClient renders student-safe exam questions, navigation, and mobile viewport toggle", () => {
    render(
      <ExamPreviewClient
        examId="exam-1"
        backHref="/teacher/exams/exam-1"
        initialStudentPayload={{
          examId: "exam-1",
          source: "draft",
          versionNumber: null,
          title: "PTS Matematika Kelas X",
          subjectName: "Matematika",
          instructions: "Kerjakan dengan teliti.",
          durationMinutes: 60,
          totalQuestions: 2,
          totalPoints: 10,
          questions: [
            {
              index: 1,
              questionId: "q-1",
              questionType: "single_choice",
              stem: "Berapa hasil $3 \\times 4$?",
              points: 5,
              options: [
                { optionKey: "A", optionText: "10", displayOrder: 0 },
                { optionKey: "B", optionText: "12", displayOrder: 1 },
              ],
            },
            {
              index: 2,
              questionId: "q-2",
              questionType: "essay",
              stem: "Jelaskan teorema Pythagoras.",
              points: 5,
              options: [],
            },
          ],
        }}
      />
    );

    expect(screen.getByText("PTS Matematika Kelas X")).toBeInTheDocument();
    expect(screen.getByText(/Nomor 1/i)).toBeInTheDocument();
    expect(screen.getByTestId("exam-preview-frame")).toHaveClass("max-w-[390px]");

    // Answer simulation and navigate to question 2
    fireEvent.click(screen.getByText("12"));
    expect(screen.getByText(/Terisi \(simulasi\): 1 \/ 2/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Berikutnya/i }));
    expect(screen.getByText(/Nomor 2/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Area jawaban esai siswa/i)).toBeInTheDocument();

    // Switch to Desktop preview width
    fireEvent.click(screen.getByRole("button", { name: /Desktop/i }));
    expect(screen.getByTestId("exam-preview-frame")).toHaveClass("max-w-4xl");
  });
});
