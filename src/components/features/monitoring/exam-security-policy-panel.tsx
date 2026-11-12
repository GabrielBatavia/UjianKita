"use client";

import * as React from "react";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import type {
  BrowserEnforcementPolicy,
  ExamSecurityPolicyRecord,
} from "@/domain/monitoring/phase4-types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function ExamSecurityPolicyPanel({
  examId,
  initialPolicy,
  onPolicySaved,
}: {
  examId: string;
  initialPolicy: ExamSecurityPolicyRecord;
  onPolicySaved?: (policy: ExamSecurityPolicyRecord) => void;
}) {
  const [policy, setPolicy] = React.useState(initialPolicy);
  const [generateSebProfileKey, setGenerateSebProfileKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "danger";
    text: string;
  } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/teacher/exams/${examId}/security-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserPolicy: policy.browserPolicy,
          exambroEnabled: policy.exambroEnabled,
          exambroMinAppHint: policy.exambroMinAppHint,
          sebEnabled: policy.sebEnabled,
          sebConfigKeyHash: policy.sebConfigKeyHash,
          sebBrowserExamKeyHash: policy.sebBrowserExamKeyHash,
          generateSebProfileKey,
          sebAllowStandardWithOverride: policy.sebAllowStandardWithOverride,
          copyPasteGuardEnabled: policy.copyPasteGuardEnabled,
          contextMenuGuardEnabled: policy.contextMenuGuardEnabled,
          watermarkEnabled: policy.watermarkEnabled,
          watermarkOpacity: policy.watermarkOpacity,
          heartbeatIntervalSeconds: policy.heartbeatIntervalSeconds,
          staleThresholdSeconds: policy.staleThresholdSeconds,
          visibilitySwitchWarnThreshold: policy.visibilitySwitchWarnThreshold,
          visibilitySwitchReviewThreshold: policy.visibilitySwitchReviewThreshold,
          hiddenDurationReviewSeconds: policy.hiddenDurationReviewSeconds,
          reloadWarnThreshold: policy.reloadWarnThreshold,
          reloadReviewThreshold: policy.reloadReviewThreshold,
          copyPasteReviewThreshold: policy.copyPasteReviewThreshold,
          privacyNoticeText: policy.privacyNoticeText,
        }),
      });
      const data = (await res.json()) as {
        policy?: ExamSecurityPolicyRecord;
        error?: string;
      };
      if (!res.ok || !data.policy) {
        setFeedback({
          type: "danger",
          text: data.error ?? "Gagal menyimpan kebijakan keamanan ujian.",
        });
        return;
      }
      setPolicy(data.policy);
      setGenerateSebProfileKey(false);
      onPolicySaved?.(data.policy);
      setFeedback({
        type: "success",
        text: `Kebijakan keamanan versi ${data.policy.versionNumber} berhasil disimpan.`,
      });
    } catch {
      setFeedback({
        type: "danger",
        text: "Terjadi kesalahan jaringan saat menyimpan kebijakan keamanan.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-blue-700" aria-hidden="true" />
              <span>Kebijakan Keamanan Peramban &amp; Pemantauan</span>
            </CardTitle>
            <CardDescription>
              Konfigurasi Safe Exam Browser, panduan QR ExamBro Android, ambang peringatan
              fokus, dan watermark halaman ujian.
            </CardDescription>
          </div>
          <Badge variant="neutral">Versi {policy.versionNumber}</Badge>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSave} className="space-y-5">
          {feedback ? (
            <Alert variant={feedback.type} title={feedback.type === "success" ? "Berhasil" : "Gagal"}>
              {feedback.text}
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="browser-policy-select">Kebijakan Akses Peramban</Label>
              <Select
                id="browser-policy-select"
                value={policy.browserPolicy}
                onChange={(e) => {
                  const next = e.target.value as BrowserEnforcementPolicy;
                  setPolicy((p) => ({
                    ...p,
                    browserPolicy: next,
                    sebEnabled: next === "VERIFIED_SEB_REQUIRED" ? true : p.sebEnabled,
                  }));
                }}
              >
                <option value="STANDARD_BROWSER_ALLOWED">
                  Peramban Standar Diizinkan (Semua Perangkat)
                </option>
                <option value="SECURE_BROWSER_RECOMMENDED">
                  Peramban Aman Disarankan (ExamBro / SEB + Fallback)
                </option>
                <option value="VERIFIED_SEB_REQUIRED">
                  Wajib Safe Exam Browser (SEB) Terverifikasi
                </option>
              </Select>
            </div>

            <div className="space-y-2 pt-2">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={policy.exambroEnabled}
                  onChange={(e) =>
                    setPolicy((p) => ({ ...p, exambroEnabled: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <span>Aktifkan Panduan &amp; Kode QR Android ExamBro</span>
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={policy.sebEnabled}
                  onChange={(e) =>
                    setPolicy((p) => ({ ...p, sebEnabled: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <span>Aktifkan Profil Unduhan (.seb) &amp; Verifikasi SEB</span>
              </label>
            </div>
          </div>

          {policy.sebEnabled && (
            <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  Konfigurasi Kunci Safe Exam Browser (SHA-256)
                </p>
                <label className="flex items-center gap-2 text-xs font-medium text-blue-800">
                  <input
                    type="checkbox"
                    checked={generateSebProfileKey}
                    onChange={(e) => setGenerateSebProfileKey(e.target.checked)}
                    className="h-4 w-4 rounded border-blue-400"
                  />
                  <span>Bangkitkan Profil .seb &amp; ConfigKey Otomatis</span>
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="seb-config-key-hash">ConfigKey Hash (64 karakter hex)</Label>
                  <Input
                    id="seb-config-key-hash"
                    value={policy.sebConfigKeyHash ?? ""}
                    onChange={(e) =>
                      setPolicy((p) => ({
                        ...p,
                        sebConfigKeyHash: e.target.value || null,
                      }))
                    }
                    placeholder="Otomatis terisi bila dicentang di atas"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="seb-bek-hash">
                    Browser Exam Key Hash (Opsional, 64 hex)
                  </Label>
                  <Input
                    id="seb-bek-hash"
                    value={policy.sebBrowserExamKeyHash ?? ""}
                    onChange={(e) =>
                      setPolicy((p) => ({
                        ...p,
                        sebBrowserExamKeyHash: e.target.value || null,
                      }))
                    }
                    placeholder="Opsional dari SEB Config Tool"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs font-medium text-slate-800">
              <input
                type="checkbox"
                checked={policy.copyPasteGuardEnabled}
                onChange={(e) =>
                  setPolicy((p) => ({ ...p, copyPasteGuardEnabled: e.target.checked }))
                }
              />
              <span>Lindungi Salin Area Soal (Esai tetap bebas ketik)</span>
            </label>

            <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs font-medium text-slate-800">
              <input
                type="checkbox"
                checked={policy.contextMenuGuardEnabled}
                onChange={(e) =>
                  setPolicy((p) => ({ ...p, contextMenuGuardEnabled: e.target.checked }))
                }
              />
              <span>Batasi Menu Konteks Area Soal</span>
            </label>

            <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs font-medium text-slate-800">
              <input
                type="checkbox"
                checked={policy.watermarkEnabled}
                onChange={(e) =>
                  setPolicy((p) => ({ ...p, watermarkEnabled: e.target.checked }))
                }
              />
              <span>Watermark Transparan Sesi Siswa</span>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="hb-interval">Interval Heartbeat (dtk)</Label>
              <Input
                id="hb-interval"
                type="number"
                min={15}
                max={120}
                value={policy.heartbeatIntervalSeconds}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    heartbeatIntervalSeconds: Number(e.target.value) || 30,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="stale-threshold">Batas Koneksi Stale (dtk)</Label>
              <Input
                id="stale-threshold"
                type="number"
                min={45}
                max={300}
                value={policy.staleThresholdSeconds}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    staleThresholdSeconds: Number(e.target.value) || 90,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vis-review">Ambang Tinjau Pindah Fokus</Label>
              <Input
                id="vis-review"
                type="number"
                min={2}
                max={100}
                value={policy.visibilitySwitchReviewThreshold}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    visibilitySwitchReviewThreshold: Number(e.target.value) || 6,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hidden-dur">Ambang Hilang Fokus (dtk)</Label>
              <Input
                id="hidden-dur"
                type="number"
                min={15}
                max={1800}
                value={policy.hiddenDurationReviewSeconds}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    hiddenDurationReviewSeconds: Number(e.target.value) || 60,
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="privacy-notice">
              Pemberitahuan Privasi Siswa (Bahasa Indonesia)
            </Label>
            <Textarea
              id="privacy-notice"
              rows={3}
              value={policy.privacyNoticeText}
              onChange={(e) =>
                setPolicy((p) => ({ ...p, privacyNoticeText: e.target.value }))
              }
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{saving ? "Menyimpan..." : "Simpan Kebijakan Keamanan"}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
