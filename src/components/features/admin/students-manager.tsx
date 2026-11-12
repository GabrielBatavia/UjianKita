"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Edit3, GraduationCap, Loader2, Plus, Search } from "lucide-react";
import type { ClassroomRecord, StudentRecord } from "@/domain/academic/types";
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

export function StudentsManager({
  initialStudents,
  classes,
  serviceRoleConfigured,
}: {
  initialStudents: StudentRecord[];
  classes: ClassroomRecord[];
  serviceRoleConfigured: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active" | "inactive">("all");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingStudent, setEditingStudent] = React.useState<StudentRecord | null>(null);

  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Create form fields
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [initialPassword, setInitialPassword] = React.useState("");
  const [nis, setNis] = React.useState("");
  const [nisn, setNisn] = React.useState("");
  const [gender, setGender] = React.useState<"" | "L" | "P">("");
  const [phone, setPhone] = React.useState("");
  const [guardianName, setGuardianName] = React.useState("");
  const [guardianPhone, setGuardianPhone] = React.useState("");
  const [classId, setClassId] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);

  function resetForm() {
    setFullName("");
    setEmail("");
    setInitialPassword("");
    setNis("");
    setNisn("");
    setGender("");
    setPhone("");
    setGuardianName("");
    setGuardianPhone("");
    setClassId("");
    setIsActive(true);
    setFormError(null);
  }

  function openCreateDialog() {
    resetForm();
    setCreateOpen(true);
  }

  function openEditDialog(student: StudentRecord) {
    setFormError(null);
    setFullName(student.full_name);
    setNis(student.nis);
    setNisn(student.nisn ?? "");
    setGender(student.gender ?? "");
    setPhone(student.phone ?? "");
    setGuardianName(student.guardian_name ?? "");
    setGuardianPhone(student.guardian_phone ?? "");
    setClassId(student.current_class_id ?? "");
    setIsActive(student.is_active);
    setEditingStudent(student);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          initialPassword,
          nis,
          nisn: nisn || null,
          gender: gender || null,
          phone: phone || null,
          guardianName: guardianName || null,
          guardianPhone: guardianPhone || null,
          classId: classId || null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal menambahkan siswa.");
        return;
      }
      setCreateOpen(false);
      router.refresh();
    } catch {
      setFormError("Terjadi kendala koneksi ke server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStudent) return;
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/admin/students/${editingStudent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          nis,
          nisn: nisn || null,
          gender: gender || null,
          phone: phone || null,
          guardianName: guardianName || null,
          guardianPhone: guardianPhone || null,
          classId: classId || null,
          isActive,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal memperbarui data siswa.");
        return;
      }
      setEditingStudent(null);
      router.refresh();
    } catch {
      setFormError("Terjadi kendala koneksi ke server.");
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = initialStudents.filter((student) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      student.full_name.toLowerCase().includes(q) ||
      student.nis.toLowerCase().includes(q) ||
      (student.nisn ?? "").toLowerCase().includes(q) ||
      student.email.toLowerCase().includes(q);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && student.is_active) ||
      (statusFilter === "inactive" && !student.is_active);
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-5">
      {!serviceRoleConfigured ? (
        <Alert variant="warning" title="Pembuatan Akun Memerlukan Kunci Server">
          Konfigurasi kunci layanan server Supabase belum diatur. Anda masih dapat melihat dan
          memperbarui data siswa yang sudah ada, namun pembuatan akun baru akan ditolak sampai
          konfigurasi server dilengkapi.
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              aria-label="Cari siswa berdasarkan nama, NIS, atau email"
              placeholder="Cari nama, NIS, NISN, atau email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              aria-label="Filter status siswa"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
            >
              <option value="all">Semua Status</option>
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </Select>
          </div>
        </div>

        <Button type="button" onClick={openCreateDialog}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Tambah Siswa</span>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={
            initialStudents.length === 0
              ? "Belum Ada Data Siswa"
              : "Tidak Ada Siswa yang Cocok"
          }
          description={
            initialStudents.length === 0
              ? "Tambahkan akun siswa pertama untuk menghubungkan siswa ke kelas dan mempersiapkannya menghadapi ujian."
              : "Ubah kata kunci pencarian atau filter status untuk melihat data siswa lainnya."
          }
          action={
            initialStudents.length === 0 ? (
              <Button type="button" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Tambah Siswa Pertama</span>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Mobile Student Cards View (< md) */}
          <div className="space-y-3 md:hidden">
            {filtered.map((student) => (
              <div
                key={student.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{student.full_name}</p>
                    <p className="text-xs text-slate-500 truncate">{student.email}</p>
                  </div>
                  <Badge variant={student.is_active ? "success" : "neutral"} className="shrink-0 text-[10px]">
                    {student.is_active ? "Aktif" : "Nonaktif"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase">Nomor Induk</span>
                    <span className="font-mono font-medium text-slate-800">
                      NIS: {student.nis}
                    </span>
                    {student.nisn ? (
                      <span className="font-mono text-slate-500 block text-[11px]">
                        NISN: {student.nisn}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase">Kelas</span>
                    {student.current_class_name ? (
                      <Badge variant="default" className="text-[10px] mt-0.5">
                        {student.current_class_name}
                      </Badge>
                    ) : (
                      <span className="text-slate-500 text-[11px]">Belum ditempatkan</span>
                    )}
                  </div>
                </div>

                {student.guardian_name ? (
                  <div className="text-xs text-slate-500">
                    Wali: <strong className="text-slate-700">{student.guardian_name}</strong>
                    {student.guardian_phone ? ` (${student.guardian_phone})` : ""}
                  </div>
                ) : null}

                <div className="flex items-center justify-end border-t border-slate-100 pt-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[40px] px-3 font-semibold text-xs"
                    onClick={() => openEditDialog(student)}
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Edit Profil</span>
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
                  <TableHead>NIS / NISN</TableHead>
                  <TableHead>Kelas Aktif</TableHead>
                  <TableHead>Wali</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((student) => (
                  <TableRow key={student.id}>
                    <TableCell>
                      <div className="font-semibold text-slate-900">{student.full_name}</div>
                      <div className="text-xs text-slate-500">{student.email}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>NIS: {student.nis}</div>
                      {student.nisn ? <div className="text-slate-500">NISN: {student.nisn}</div> : null}
                    </TableCell>
                    <TableCell>
                      {student.current_class_name ? (
                        <Badge variant="default">{student.current_class_name}</Badge>
                      ) : (
                        <span className="text-xs text-slate-500">Belum ditempatkan</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      <div>{student.guardian_name ?? "-"}</div>
                      {student.guardian_phone ? <div>{student.guardian_phone}</div> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={student.is_active ? "success" : "neutral"}>
                        {student.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(student)}
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Edit</span>
                      </Button>
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
            <DialogTitle>Tambah Akun Siswa</DialogTitle>
            <DialogDescription>
              Sistem akan membuat akun autentikasi Supabase serta profil siswa secara atomik.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cs-name">Nama Lengkap</Label>
                <Input
                  id="cs-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cs-email">Email Sekolah</Label>
                <Input
                  id="cs-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cs-password">Kata Sandi Awal</Label>
                <Input
                  id="cs-password"
                  type="password"
                  minLength={8}
                  value={initialPassword}
                  onChange={(e) => setInitialPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cs-nis">NIS</Label>
                <Input id="cs-nis" value={nis} onChange={(e) => setNis(e.target.value)} required />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cs-nisn">NISN (10 digit, opsional)</Label>
                <Input id="cs-nisn" value={nisn} onChange={(e) => setNisn(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cs-gender">Jenis Kelamin</Label>
                <Select
                  id="cs-gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as "" | "L" | "P")}
                >
                  <option value="">Pilih (Opsional)</option>
                  <option value="L">Laki-laki</option>
                  <option value="P">Perempuan</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cs-class">Penempatan Kelas</Label>
                <Select id="cs-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
                  <option value="">Belum Ditempatkan</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name} ({cls.academic_year_name ?? "-"})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cs-guardian">Nama Wali</Label>
                <Input
                  id="cs-guardian"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cs-guardian-phone">Telepon Wali</Label>
                <Input
                  id="cs-guardian-phone"
                  value={guardianPhone}
                  onChange={(e) => setGuardianPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Simpan Siswa</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={Boolean(editingStudent)} onOpenChange={(open) => !open && setEditingStudent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Data Siswa</DialogTitle>
            <DialogDescription>
              Perubahan penempatan kelas dan status akun akan dicatat pada log audit sekolah.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="es-name">Nama Lengkap</Label>
                <Input
                  id="es-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="es-nis">NIS</Label>
                <Input id="es-nis" value={nis} onChange={(e) => setNis(e.target.value)} required />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="es-nisn">NISN</Label>
                <Input id="es-nisn" value={nisn} onChange={(e) => setNisn(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="es-class">Kelas Aktif</Label>
                <Select id="es-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
                  <option value="">Tidak Terdaftar di Kelas</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name} ({cls.academic_year_name ?? "-"})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="es-status">Status Akun</Label>
                <Select
                  id="es-status"
                  value={isActive ? "active" : "inactive"}
                  onChange={(e) => setIsActive(e.target.value === "active")}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="es-guardian">Nama Wali</Label>
                <Input
                  id="es-guardian"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="es-guardian-phone">Telepon Wali</Label>
                <Input
                  id="es-guardian-phone"
                  value={guardianPhone}
                  onChange={(e) => setGuardianPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingStudent(null)}>
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
    </div>
  );
}
