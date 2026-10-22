'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileImage, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CaptureContextForm } from '@/components/inspection/CaptureContextForm';
import { inspectionService, type CaptureContext } from '@/lib/services';
import { ApiError } from '@/lib/api';

type Stage = 'idle' | 'creating' | 'vision' | 'evaluating' | 'done';

const STAGE_LABELS: Record<Stage, string> = {
  idle: '',
  creating: 'Raising the inspection…',
  vision: 'Reading the label and measuring the declarations…',
  evaluating: 'Evaluating statutory rules…',
  done: 'Complete',
};

const MAX_BYTES = 20 * 1024 * 1024;

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<CaptureContext>({ panel: 'principal' });

  const acceptFile = (candidate: File | undefined) => {
    if (!candidate) return;
    setError(null);

    if (!['image/jpeg', 'image/png'].includes(candidate.type)) {
      setError('Only JPEG and PNG images are accepted.');
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError('That image is larger than the 20 MB limit.');
      return;
    }

    setFile(candidate);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(candidate);
    });
  };

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setStage('idle');
    setError(null);
  };

  const handleAnalyse = async () => {
    if (!file) return;
    setError(null);

    try {
      setStage('creating');
      const inspection = await inspectionService.create({});

      // The full-resolution original goes to the vision service: extraction and
      // every measurement run on it, never on a compressed copy.
      setStage('vision');
      await inspectionService.vision(inspection._id, file, context);

      setStage('evaluating');
      await inspectionService.evaluate(inspection._id);

      setStage('done');
      router.push(`/results/${inspection._id}`);
    } catch (err) {
      setStage('idle');
      setError(err instanceof ApiError ? err.message : 'The analysis could not be completed.');
    }
  };

  const isBusy = stage !== 'idle' && stage !== 'done';

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="page-title">Upload package images</h1>
        <p className="page-subtitle">
          The label is read, rectified and measured, then tested against the rule pack.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-verdict-fail/25 bg-verdict-fail/5 p-3 text-sm text-verdict-fail">
          {error}
        </div>
      )}

      {!file ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            acceptFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          className={`focus-ring cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
            isDragging
              ? 'border-cyan-bright bg-cyan-50'
              : 'border-cyan-300 bg-white hover:border-cyan-bright hover:bg-cyan-50/60'
          }`}
        >
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-cyan-50 text-cyan-600">
            <Upload className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="text-base font-medium text-cyan-950">Drag and drop a package image</p>
          <p className="mt-1 text-sm text-slate-500">or click to browse your device</p>
          <p className="mt-4 text-xs text-slate-400">JPEG or PNG, up to 20 MB</p>

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => acceptFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="card overflow-hidden">
            <div className="relative bg-cyan-950/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview!} alt="Package preview" className="mx-auto max-h-80 object-contain" />
              {!isBusy && (
                <button
                  onClick={reset}
                  className="focus-ring absolute right-3 top-3 rounded-full bg-white/90 p-2 text-slate-600 shadow-card transition-colors hover:bg-white hover:text-verdict-fail"
                  aria-label="Remove image"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-cyan-100 p-3 text-sm">
              <FileImage className="h-4 w-4 flex-shrink-0 text-cyan-600" aria-hidden="true" />
              <span className="truncate text-slate-700">{file.name}</span>
              <span className="flex-shrink-0 text-xs text-slate-400">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </div>
          </div>

          <CaptureContextForm value={context} onChange={setContext} disabled={isBusy} />

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={reset} disabled={isBusy}>
              Choose another
            </Button>
            <Button onClick={handleAnalyse} isLoading={isBusy}>
              Upload and analyse
            </Button>
          </div>

          {isBusy && (
            <div className="flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {STAGE_LABELS[stage]}
            </div>
          )}

          {stage === 'done' && (
            <div className="flex items-center gap-2 rounded-lg border border-verdict-pass/25 bg-verdict-pass/5 px-4 py-3 text-sm text-verdict-pass">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Analysis complete — opening the results…
            </div>
          )}
        </div>
      )}

      <ol className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-4">
        {[
          { step: '1', title: 'Quality gate', body: 'Blur and glare are caught before anything is measured.' },
          { step: '2', title: 'Rectify & calibrate', body: 'Perspective is corrected, then pixels become millimetres.' },
          { step: '3', title: 'Read & measure', body: 'OCR locates the numerals; heights come off a binarised crop.' },
          { step: '4', title: 'Evaluate', body: 'Rules 6 to 13 run deterministically over the extraction.' },
        ].map((item) => (
          <li key={item.step} className="card p-4">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-cyan-bright text-xs font-bold text-white">
              {item.step}
            </span>
            <p className="mt-3 text-sm font-medium text-cyan-950">{item.title}</p>
            <p className="mt-1 text-xs text-slate-500">{item.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
