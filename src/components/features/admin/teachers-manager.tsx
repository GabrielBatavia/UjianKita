"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookPlus, Edit3, Loader2, Plus, Search, Trash2, UserCheck } from "lucide-react";
import type {
  AcademicYearRecord,
  ClassroomRecord,
  EmploymentStatus,
  SubjectRecord,
  TeacherRecord,
} from "@/domain/academic/types";
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
import { EmptyState } from "@/components/layout/empty-state";

export function TeachersManager({
  initialTeachers,
  classes,
  subjects,
  academicYears,
  serviceRoleConfigured,
}: {
  initialTeachers: TeacherRecord[];
  classes: ClassroomRecord[];
  subjects: SubjectRecord[];
  academicYears: AcademicYearRecord[];
  serviceRoleConfigured: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingTeacher, setEditingTeacher] = React.useState<TeacherRecord | null>(null);
  const [assignTeacher, setAssignTeacher] = React.useState<TeacherRecord | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [initialPassword, setInitialPassword] = React.useState("");
  const [nip, setNip] = React.useState("");
  const [specialization, setSpecialization] = React.useState("");
  const [employmentStatus, setEmploymentStatus] = React.useState<EmploymentStatus>("GTY");
  const [phone, setPhone] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);

  const [assignClassId, setAssignClassId] = React.useState("");
  const [assignSubjectId, setAssignSubjectId] = React.useState("");
  const [assignYearId, setAssignYearId] = React.useState(
    academicYears.find((y) => y.is_active)?.id ?? academicYears[0]?.id ?? ""
  );

  function openCreateDialog() {
    setFormError(null);
    setFullName("");
    setEmail("");
    setInitialPassword("");
    setNip("");
    setSpecialization("");
    setEmploymentStatus("GTY");
    setPhone("");
    setIsActive(true);
    setCreateOpen(true);
  }

  function openEditDialog(teacher: TeacherRecord) {
    setFormError(null);
    setFullName(teacher.full_name);
    setNip(teacher.nip ?? "");
    setSpecialization(teacher.specialization ?? "");
    setEmploymentStatus(teacher.employment_status);
    setPhone(teacher.phone ?? "");
    setIsActive(teacher.is_active);
    setEditingTeacher(teacher);
  }

  function openAssignDialog(teacher: TeacherRecord) {
    setFormError(null);
    setAssignClassId(classes[0]?.id ?? "");
    setAssignSubjectId(subjects[0]?.id ?? "");
    setAssignYearId(academicYears.find((y) => y.is_active)?.id ?? academicYears[0]?.id ?? "");
    setAssignTeacher(teacher);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          initialPassword,
          nip: nip || null,
          specialization: specialization || null,
          employmentStatus,
          phone: phone || null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal menambahkan akun guru.");
        return;
      }
      setCreateOpen(false);
      router.refresh();
    } catch {
      setFormError("Gagal menghubungi server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTeacher) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/teachers/${editingTeacher.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          nip: nip || null,
          specialization: specialization || null,
          employmentStatus,
          phone: phone || null,
          isActive,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal memperbarui data guru.");
        return;
      }
      setEditingTeacher(null);
      router.refresh();
    } catch {
      setFormError("Gagal menghubungi server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignTeacher) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/teachers/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId: assignTeacher.id,
          classId: assignClassId,
          subjectId: assignSubjectId,
          academicYearId: assignYearId,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal menambahkan penugasan.");
        return;
      }
      setAssignTeacher(null);
      router.refresh();
    } catch {
      setFormError("Gagal menghubungi server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveAssignment(assignmentId: string) {
    const res = await fetch(`/api/admin/teachers/assignments/${assignmentId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.refresh();
    }
  }

  const filtered = initialTeachers.filter((teacher) => {
    const q = search.trim().toLowerCase();
    return (
      !q ||
      teacher.full_name.toLowerCase().includes(q) ||
      (teacher.nip ?? "").toLowerCase().includes(q) ||
      teacher.email.toLowerCase().includes(q) ||
      (teacher.specialization ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      {!serviceRoleConfigured ? (
        <Alert variant="warning" title="Pembuatan Akun Memerlukan Kunci Server">
          Konfigurasi kunci layanan server Supabase belum diatur. Fitur tambah akun guru baru
          memerlukan konfigurasi tersebut pada server.
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            aria-label="Cari guru berdasarkan nama, NIP, atau email"
            placeholder="Cari nama, NIP, email, bidang..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Button type="button" onClick={openCreateDialog}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Tambah Guru</span>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title={initialTeachers.length === 0 ? "Belum Ada Data Guru" : "Guru Tidak Ditemukan"}
          description={
            initialTeachers.length === 0
              ? "Tambahkan akun guru dan tetapkan kelas serta mata pelajaran yang diampu."
              : "Coba ubah kata kunci pencarian Anda."
          }
          action={
            initialTeachers.length === 0 ? (
              <Button type="button" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Tambah Guru Pertama</span>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Mobile Teacher Cards View (< md) */}
          <div className="space-y-3 md:hidden">
            {filtered.map((teacher) => (
              <div
                key={teacher.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{teacher.full_name}</p>
                    <p className="text-xs text-slate-500 truncate">{teacher.email}</p>
                    {teacher.specialization ? (
                      <p className="text-xs text-slate-600 mt-0.5">{teacher.specialization}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant={teacher.is_active ? "success" : "neutral"} className="text-[10px]">
                      {teacher.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                    <Badge variant="neutral" className="text-[10px]">
                      {teacher.employment_status}
                    </Badge>
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 uppercase">NIP</span>
                    <span className="font-mono font-medium text-slate-800">{teacher.nip ?? "-"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase mb-1">
                      Penugasan Mengajar
                    </span>
                    {teacher.assignments && teacher.assignments.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {teacher.assignments.map((a) => (
                          <span
                            key={a.id}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
                          >
                            <span>
                              {a.class_name} • {a.subject_name}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveAssignment(a.id)}
                              aria-label={`Hapus penugasan ${a.class_name} ${a.subject_name}`}
                              className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Belum ada penugasan</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[40px] px-3 font-semibold text-xs"
                    onClick={() => openAssignDialog(teacher)}
                  >
                    <BookPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tugaskan</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[40px] px-3 font-semibold text-xs"
                    onClick={() => openEditDialog(teacher)}
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Edit</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table (>= md) */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama &amp; Email</TableHead>
                  <TableHead>NIP / Kepegawaian</TableHead>
                  <TableHead>Penugasan Mengajar</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((teacher) => (
                  <TableRow key={teacher.id}>
                    <TableCell>
                      <div className="font-semibold text-slate-900">{teacher.full_name}</div>
                      <div className="text-xs text-slate-500">{teacher.email}</div>
                      {teacher.specialization ? (
                        <div className="text-xs text-slate-600">{teacher.specialization}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-mono">{teacher.nip ?? "-"}</div>
                      <Badge variant="neutral" className="mt-1">
                        {teacher.employment_status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {teacher.assignments && teacher.assignments.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {teacher.assignments.map((a) => (
                            <span
                              key={a.id}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                            >
                              <span>
                                {a.class_name} • {a.subject_name}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveAssignment(a.id)}
                                aria-label={`Hapus penugasan ${a.class_name} ${a.subject_name}`}
                                className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">Belum ada penugasan</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={teacher.is_active ? "success" : "neutral"}>
                        {teacher.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openAssignDialog(teacher)}
                        >
                          <BookPlus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Tugaskan</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(teacher)}
                        >
                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Edit</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Akun Guru</DialogTitle>
            <DialogDescription>
              Guru yang ditambahkan dapat masuk ke ruang kerja guru dan mengakses kelas yang
              ditugaskan.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ct-name">Nama Lengkap</Label>
                <Input
                  id="ct-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-email">Email</Label>
                <Input
                  id="ct-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-password">Kata Sandi Awal</Label>
                <Input
                  id="ct-password"
                  type="password"
                  minLength={8}
                  value={initialPassword}
                  onChange={(e) => setInitialPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-nip">NIP (Opsional)</Label>
                <Input id="ct-nip" value={nip} onChange={(e) => setNip(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-emp">Status Kepegawaian</Label>
                <Select
                  id="ct-emp"
                  value={employmentStatus}
                  onChange={(e) => setEmploymentStatus(e.target.value as EmploymentStatus)}
                >
                  <option value="ASN">ASN</option>
                  <option value="PPPK">PPPK</option>
                  <option value="GTY">GTY</option>
                  <option value="GTT">GTT</option>
                  <option value="HONORER">Honorer</option>
                  <option value="LAINNYA">Lainnya</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-spec">Bidang Studi</Label>
                <Input
                  id="ct-spec"
                  value={specialization}
                  onChange={(e) => setSpecialization(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-phone">Telepon</Label>
                <Input id="ct-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Simpan Guru</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={Boolean(editingTeacher)} onOpenChange={(open) => !open && setEditingTeacher(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Data Guru</DialogTitle>
            <DialogDescription>Perbarui informasi kepegawaian atau status akun guru.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="et-name">Nama Lengkap</Label>
                <Input
                  id="et-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="et-nip">NIP</Label>
                <Input id="et-nip" value={nip} onChange={(e) => setNip(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="et-emp">Status Kepegawaian</Label>
                <Select
                  id="et-emp"
                  value={employmentStatus}
                  onChange={(e) => setEmploymentStatus(e.target.value as EmploymentStatus)}
                >
                  <option value="ASN">ASN</option>
                  <option value="PPPK">PPPK</option>
                  <option value="GTY">GTY</option>
                  <option value="GTT">GTT</option>
                  <option value="HONORER">Honorer</option>
                  <option value="LAINNYA">Lainnya</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="et-spec">Bidang Studi</Label>
                <Input
                  id="et-spec"
                  value={specialization}
                  onChange={(e) => setSpecialization(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="et-status">Status Akun</Label>
                <Select
                  id="et-status"
                  value={isActive ? "active" : "inactive"}
                  onChange={(e) => setIsActive(e.target.value === "active")}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingTeacher(null)}>
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

      {/* Assign Class & Subject Dialog */}
      <Dialog open={Boolean(assignTeacher)} onOpenChange={(open) => !open && setAssignTeacher(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tetapkan Penugasan Mengajar</DialogTitle>
            <DialogDescription>
              Tetapkan kelas dan mata pelajaran untuk <strong>{assignTeacher?.full_name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAssign} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="at-year">Tahun Ajaran</Label>
                <Select
                  id="at-year"
                  value={assignYearId}
                  onChange={(e) => setAssignYearId(e.target.value)}
                  required
                >
                  <option value="">Pilih Tahun Ajaran</option>
                  {academicYears.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name} ({y.semester})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="at-class">Kelas</Label>
                <Select
                  id="at-class"
                  value={assignClassId}
                  onChange={(e) => setAssignClassId(e.target.value)}
                  required
                >
                  <option value="">Pilih Kelas</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — Tingkat {c.grade_level}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="at-subject">Mata Pelajaran</Label>
                <Select
                  id="at-subject"
                  value={assignSubjectId}
                  onChange={(e) => setAssignSubjectId(e.target.value)}
                  required
                >
                  <option value="">Pilih Mata Pelajaran</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAssignTeacher(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Simpan Penugasan</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
