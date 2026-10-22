'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CameraOff, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CaptureContextForm } from '@/components/inspection/CaptureContextForm';
import { inspectionService, type CaptureContext } from '@/lib/services';
import { ApiError } from '@/lib/api';

type Stage = 'idle' | 'creating' | 'vision' | 'evaluating';

export default function CameraPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [context, setContext] = useState<CaptureContext>({ panel: 'principal' });
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsStreaming(false);
  }, []);

  const startStream = useCallback(async () => {
    setError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not expose a camera. Use the upload page instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsStreaming(true);
    } catch {
      setError('Camera access was denied. Grant permission, or use the upload page instead.');
    }
  }, []);

  useEffect(() => {
    startStream();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isStreaming) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
    );
    if (!blob) {
      setError('The frame could not be captured. Please try again.');
      return;
    }

    const file = new File([blob], `capture-${context.panel}-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });

    try {
      setStage('creating');
      const inspection = await inspectionService.create({});

      setStage('vision');
      await inspectionService.vision(inspection._id, file, context);

      setStage('evaluating');
      await inspectionService.evaluate(inspection._id);

      stopStream();
      router.push(`/results/${inspection._id}`);
    } catch (err) {
      setStage('idle');
      setError(err instanceof ApiError ? err.message : 'The capture could not be analysed.');
    }
  };

  const isBusy = stage !== 'idle';

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col p-4 lg:p-8">
      <div className="mb-4">
        <h1 className="page-title">Scan package label</h1>
        <p className="page-subtitle">Align the declaration panel inside the frame, then capture.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-verdict-fail/25 bg-verdict-fail/5 p-3 text-sm text-verdict-fail">
          {error}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden rounded-xl bg-cyan-950">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full max-h-[60vh] w-full object-contain ${isStreaming ? '' : 'invisible'}`}
        />
        <canvas ref={canvasRef} className="hidden" />

        {!isStreaming && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-cyan-300">
                <CameraOff className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="text-sm text-cyan-100">Camera preview is not active</p>
              <Button variant="secondary" className="mt-4" onClick={startStream}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Retry camera
              </Button>
            </div>
          </div>
        )}

        {/* Viewfinder */}
        <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-dashed border-cyan-300/70" />
        <span className="pointer-events-none absolute left-4 top-4 rounded-full bg-cyan-950/70 px-3 py-1 text-xs font-medium text-cyan-100">
          {context.panel === 'principal' ? 'Principal display panel' : `${context.panel} panel`}
          {context.referenceWidthMm ? ` · ${context.referenceWidthMm} mm reference` : ' · no scale'}
        </span>

        {isBusy && (
          <div className="absolute inset-0 grid place-items-center bg-cyan-950/70 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm text-cyan-100">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {stage === 'creating'
                ? 'Raising the inspection…'
                : stage === 'vision'
                  ? 'Reading the label and measuring the declarations…'
                  : 'Evaluating statutory rules…'}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <CaptureContextForm value={context} onChange={setContext} disabled={isBusy} />

        <Button size="lg" onClick={capture} disabled={!isStreaming} isLoading={isBusy}>
          <Camera className="h-4 w-4" aria-hidden="true" />
          Capture and analyse
        </Button>
      </div>
    </div>
  );
}
