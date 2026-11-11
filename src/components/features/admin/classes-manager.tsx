"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Calendar, Edit3, Loader2, Plus, School } from "lucide-react";
import type { AcademicYearRecord, ClassroomRecord, TeacherRecord } from "@/domain/academic/types";
import { formatDateId } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/layout/empty-state";

export function ClassesManager({
  initialClasses,
  initialAcademicYears,
  teachers,
}: {
  initialClasses: ClassroomRecord[];
  initialAcademicYears: AcademicYearRecord[];
  teachers: TeacherRecord[];
}) {
  const router = useRouter();
  const [classDialogOpen, setClassDialogOpen] = React.useState(false);
  const [editingClass, setEditingClass] = React.useState<ClassroomRecord | null>(null);
  const [yearDialogOpen, setYearDialogOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Class fields
  const [academicYearId, setAcademicYearId] = React.useState(
    initialAcademicYears.find((y) => y.is_active)?.id ?? initialAcademicYears[0]?.id ?? ""
  );
  const [name, setName] = React.useState("");
  const [gradeLevel, setGradeLevel] = React.useState("10");
  const [program, setProgram] = React.useState("");
  const [homeroomTeacherId, setHomeroomTeacherId] = React.useState("");
  const [capacity, setCapacity] = React.useState("36");
  const [isActive, setIsActive] = React.useState(true);

  // Academic Year fields
  const [yearName, setYearName] = React.useState("2026/2027");
  const [semester, setSemester] = React.useState<"Ganjil" | "Genap" | "Tahunan">("Ganjil");
  const [startsOn, setStartsOn] = React.useState("2026-07-13");
  const [endsOn, setEndsOn] = React.useState("2026-12-18");
  const [yearIsActive, setYearIsActive] = React.useState(true);

  function openCreateClass() {
    setFormError(null);
    setAcademicYearId(
      initialAcademicYears.find((y) => y.is_active)?.id ?? initialAcademicYears[0]?.id ?? ""
    );
    setName("");
    setGradeLevel("10");
    setProgram("");
    setHomeroomTeacherId("");
    setCapacity("36");
    setIsActive(true);
    setClassDialogOpen(true);
  }

  function openEditClass(cls: ClassroomRecord) {
    setFormError(null);
    setName(cls.name);
    setGradeLevel(cls.grade_level);
    setProgram(cls.program ?? "");
    setHomeroomTeacherId(cls.homeroom_teacher_id ?? "");
    setCapacity(cls.capacity ? String(cls.capacity) : "");
    setIsActive(cls.is_active);
    setEditingClass(cls);
  }

  async function handleCreateClass(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academicYearId,
          name,
          gradeLevel,
          program: program || null,
          homeroomTeacherId: homeroomTeacherId || null,
          capacity: capacity ? Number(capacity) : null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal menambahkan kelas.");
        return;
      }
      setClassDialogOpen(false);
      router.refresh();
    } catch {
      setFormError("Gagal menghubungi server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateClass(e: React.FormEvent) {
    e.preventDefault();
    if (!editingClass) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/classes/${editingClass.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          gradeLevel,
          program: program || null,
          homeroomTeacherId: homeroomTeacherId || null,
          capacity: capacity ? Number(capacity) : null,
          isActive,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal memperbarui kelas.");
        return;
      }
      setEditingClass(null);
      router.refresh();
    } catch {
      setFormError("Gagal menghubungi server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateYear(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/academic-years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: yearName,
          semester,
          startsOn,
          endsOn,
          isActive: yearIsActive,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal menambahkan tahun ajaran.");
        return;
      }
      setYearDialogOpen(false);
      router.refresh();
    } catch {
      setFormError("Gagal menghubungi server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Tabs defaultValue="classes">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList>
          <TabsTrigger value="classes">Daftar Kelas ({initialClasses.length})</TabsTrigger>
          <TabsTrigger value="years">Tahun Ajaran ({initialAcademicYears.length})</TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFormError(null);
              setYearDialogOpen(true);
            }}
          >
            <Calendar className="h-4 w-4" aria-hidden="true" />
            <span>Tambah Tahun Ajaran</span>
          </Button>
          <Button
            type="button"
            onClick={openCreateClass}
            disabled={initialAcademicYears.length === 0}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Tambah Kelas</span>
          </Button>
        </div>
      </div>

      <TabsContent value="classes">
        {initialClasses.length === 0 ? (
          <EmptyState
            icon={School}
            title="Belum Ada Kelas Terdaftar"
            description={
              initialAcademicYears.length === 0
                ? "Tambahkan Tahun Ajaran terlebih dahulu sebelum membuat kelas."
                : "Buat kelas pertama untuk mulai menempatkan siswa dan menugaskan guru."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Kelas</TableHead>
                <TableHead>Tingkat / Program</TableHead>
                <TableHead>Tahun Ajaran</TableHead>
                <TableHead>Wali Kelas</TableHead>
                <TableHead>Siswa Terdaftar</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialClasses.map((cls) => (
                <TableRow key={cls.id}>
                  <TableCell className="font-semibold text-slate-900">{cls.name}</TableCell>
                  <TableCell>
                    <div>Tingkat {cls.grade_level}</div>
                    {cls.program ? (
                      <div className="text-xs text-slate-500">{cls.program}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {cls.academic_year_name ?? "-"} ({cls.academic_year_semester ?? "-"})
                  </TableCell>
                  <TableCell>{cls.homeroom_teacher_name ?? "-"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {cls.enrolled_count ?? 0}
                    {cls.capacity ? ` / ${cls.capacity}` : ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={cls.is_active ? "success" : "neutral"}>
                      {cls.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEditClass(cls)}
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Edit</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <TabsContent value="years">
        {initialAcademicYears.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="Belum Ada Tahun Ajaran"
            description="Tambahkan tahun ajaran aktif untuk mengatur struktur kelas."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tahun Ajaran</TableHead>
                <TableHead>Semester</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialAcademicYears.map((y) => (
                <TableRow key={y.id}>
                  <TableCell className="font-semibold">{y.name}</TableCell>
                  <TableCell>{y.semester}</TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {formatDateId(y.starts_on)} — {formatDateId(y.ends_on)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={y.is_active ? "success" : "neutral"}>
                      {y.is_active ? "Aktif" : "Arsip"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      {/* Create Class Dialog */}
      <Dialog open={classDialogOpen} onOpenChange={setClassDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Kelas Baru</DialogTitle>
            <DialogDescription>
              Kelompok belajar siswa dalam satu tahun ajaran sekolah.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateClass} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cc-year">Tahun Ajaran</Label>
                <Select
                  id="cc-year"
                  value={academicYearId}
                  onChange={(e) => setAcademicYearId(e.target.value)}
                  required
                >
                  {initialAcademicYears.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name} ({y.semester})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cc-name">Nama Kelas</Label>
                <Input
                  id="cc-name"
                  placeholder="Mis. X IPA 1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cc-grade">Tingkat</Label>
                <Input
                  id="cc-grade"
                  placeholder="Mis. 10"
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cc-program">Jurusan / Program</Label>
                <Input
                  id="cc-program"
                  placeholder="Mis. IPA / Umum"
                  value={program}
                  onChange={(e) => setProgram(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cc-cap">Kapasitas Siswa</Label>
                <Input
                  id="cc-cap"
                  type="number"
                  min={1}
                  max={100}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cc-homeroom">Wali Kelas (Opsional)</Label>
                <Select
                  id="cc-homeroom"
                  value={homeroomTeacherId}
                  onChange={(e) => setHomeroomTeacherId(e.target.value)}
                >
                  <option value="">Belum Ditentukan</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setClassDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Simpan Kelas</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Class Dialog */}
      <Dialog open={Boolean(editingClass)} onOpenChange={(open) => !open && setEditingClass(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Kelas</DialogTitle>
            <DialogDescription>Perbarui nama, wali kelas, kapasitas, atau status.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateClass} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ec-name">Nama Kelas</Label>
                <Input
                  id="ec-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ec-grade">Tingkat</Label>
                <Input
                  id="ec-grade"
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ec-program">Program / Jurusan</Label>
                <Input
                  id="ec-program"
                  value={program}
                  onChange={(e) => setProgram(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ec-cap">Kapasitas</Label>
                <Input
                  id="ec-cap"
                  type="number"
                  min={1}
                  max={100}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ec-homeroom">Wali Kelas</Label>
                <Select
                  id="ec-homeroom"
                  value={homeroomTeacherId}
                  onChange={(e) => setHomeroomTeacherId(e.target.value)}
                >
                  <option value="">Tidak Ada</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ec-status">Status</Label>
                <Select
                  id="ec-status"
                  value={isActive ? "active" : "inactive"}
                  onChange={(e) => setIsActive(e.target.value === "active")}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingClass(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Simpan Perubahan</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Academic Year Dialog */}
      <Dialog open={yearDialogOpen} onOpenChange={setYearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Tahun Ajaran</DialogTitle>
            <DialogDescription>
              Hanya satu tahun ajaran yang dapat berstatus aktif pada saat yang bersamaan.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateYear} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cy-name">Tahun Ajaran</Label>
                <Input
                  id="cy-name"
                  placeholder="2026/2027"
                  value={yearName}
                  onChange={(e) => setYearName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cy-sem">Semester</Label>
                <Select
                  id="cy-sem"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value as "Ganjil" | "Genap" | "Tahunan")}
                >
                  <option value="Ganjil">Ganjil</option>
                  <option value="Genap">Genap</option>
                  <option value="Tahunan">Tahunan</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cy-start">Tanggal Mulai</Label>
                <Input
                  id="cy-start"
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cy-end">Tanggal Selesai</Label>
                <Input
                  id="cy-end"
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                  required
                />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="cy-active"
                  type="checkbox"
                  checked={yearIsActive}
                  onChange={(e) => setYearIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <Label htmlFor="cy-active">Jadikan sebagai tahun ajaran aktif</Label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setYearDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Simpan Tahun Ajaran</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
