"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Edit3, Loader2, Plus, Search } from "lucide-react";
import type { SubjectRecord } from "@/domain/academic/types";
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
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/layout/empty-state";

export function SubjectsManager({ initialSubjects }: { initialSubjects: SubjectRecord[] }) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingSubject, setEditingSubject] = React.useState<SubjectRecord | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [curriculumGroup, setCurriculumGroup] = React.useState("Wajib");
  const [description, setDescription] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);

  function openCreate() {
    setFormError(null);
    setCode("");
    setName("");
    setCurriculumGroup("Wajib");
    setDescription("");
    setIsActive(true);
    setCreateOpen(true);
  }

  function openEdit(subject: SubjectRecord) {
    setFormError(null);
    setCode(subject.code);
    setName(subject.name);
    setCurriculumGroup(subject.curriculum_group);
    setDescription(subject.description ?? "");
    setIsActive(subject.is_active);
    setEditingSubject(subject);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          curriculumGroup,
          description: description || null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal menambahkan mata pelajaran.");
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
    if (!editingSubject) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/subjects/${editingSubject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          curriculumGroup,
          description: description || null,
          isActive,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Gagal memperbarui mata pelajaran.");
        return;
      }
      setEditingSubject(null);
      router.refresh();
    } catch {
      setFormError("Gagal menghubungi server.");
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = initialSubjects.filter((s) => {
    const q = search.trim().toLowerCase();
    return (
      !q ||
      s.code.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.curriculum_group.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            aria-label="Cari mata pelajaran"
            placeholder="Cari kode atau nama pelajaran..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Button type="button" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Tambah Mata Pelajaran</span>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={
            initialSubjects.length === 0
              ? "Belum Ada Mata Pelajaran"
              : "Mata Pelajaran Tidak Ditemukan"
          }
          description="Tambahkan daftar mata pelajaran sekolah agar dapat ditugaskan kepada guru dan kelas."
          action={
            initialSubjects.length === 0 ? (
              <Button type="button" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Tambah Mata Pelajaran Pertama</span>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Mobile Subjects Cards View (< md) */}
          <div className="space-y-3 md:hidden">
            {filtered.map((subject) => (
              <div
                key={subject.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-semibold text-blue-800">
                      {subject.code}
                    </span>
                    <p className="font-semibold text-slate-900 truncate text-base mt-0.5">
                      {subject.name}
                    </p>
                    {subject.description ? (
                      <p className="text-xs text-slate-500 mt-0.5">{subject.description}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant={subject.is_active ? "success" : "neutral"} className="text-[10px]">
                      {subject.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                    <Badge variant="neutral" className="text-[10px]">
                      {subject.curriculum_group}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center justify-end border-t border-slate-100 pt-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[40px] px-3 font-semibold text-xs"
                    onClick={() => openEdit(subject)}
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Edit Mapel</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Subjects Table (>= md) */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Nama Mata Pelajaran</TableHead>
                  <TableHead>Kelompok</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((subject) => (
                  <TableRow key={subject.id}>
                    <TableCell className="font-mono text-xs font-semibold text-blue-800">
                      {subject.code}
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-slate-900">{subject.name}</div>
                      {subject.description ? (
                        <div className="text-xs text-slate-500">{subject.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">{subject.curriculum_group}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={subject.is_active ? "success" : "neutral"}>
                        {subject.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(subject)}>
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
            <DialogTitle>Tambah Mata Pelajaran</DialogTitle>
            <DialogDescription>
              Kode mata pelajaran akan disimpan dalam huruf kapital dan harus unik per sekolah.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="csub-code">Kode Mapel</Label>
                <Input
                  id="csub-code"
                  placeholder="Mis. MAT-10"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="csub-group">Kelompok Kurikulum</Label>
                <Input
                  id="csub-group"
                  value={curriculumGroup}
                  onChange={(e) => setCurriculumGroup(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="csub-name">Nama Mata Pelajaran</Label>
                <Input
                  id="csub-name"
                  placeholder="Mis. Matematika Wajib"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="csub-desc">Keterangan (Opsional)</Label>
                <Textarea
                  id="csub-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Simpan Mapel</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={Boolean(editingSubject)} onOpenChange={(open) => !open && setEditingSubject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Mata Pelajaran</DialogTitle>
            <DialogDescription>Perbarui informasi atau status aktif mata pelajaran.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="esub-code">Kode Mapel</Label>
                <Input
                  id="esub-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="esub-group">Kelompok Kurikulum</Label>
                <Input
                  id="esub-group"
                  value={curriculumGroup}
                  onChange={(e) => setCurriculumGroup(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="esub-name">Nama Mata Pelajaran</Label>
                <Input
                  id="esub-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="esub-status">Status</Label>
                <Select
                  id="esub-status"
                  value={isActive ? "active" : "inactive"}
                  onChange={(e) => setIsActive(e.target.value === "active")}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="esub-desc">Keterangan</Label>
                <Textarea
                  id="esub-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingSubject(null)}>
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
