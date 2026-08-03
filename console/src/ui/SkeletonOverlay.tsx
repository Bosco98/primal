import { useEffect, useRef, type RefObject } from 'react';
import { POSE_CONNECTIONS } from '../pose/landmarks.js';
import type { PoseFrame } from '../pose/types.js';
import type { DepthGuide } from '../recognition/engine.js';

interface Props {
  video: HTMLVideoElement | null;
  /**
   * Read as a ref, not a prop value: frames arrive at 30Hz and React renders at
   * 12Hz, so the canvas would visibly lag the player if it waited for renders.
   */
  frameRef: RefObject<PoseFrame | null>;
  /** Also a ref, and for the same reason: the guide tracks the hips live. */
  guideRef: RefObject<DepthGuide | null>;
  deepEnoughRef: RefObject<boolean>;
  /** Dim the skeleton when input is not trustworthy. */
  quality: number;
}

/**
 * Mirrored camera preview with the skeleton drawn over it.
 *
 * Mirroring happens here in the canvas transform, not in the landmark data, so
 * the numbers the recognisers see stay in raw camera space. The player sees a
 * mirror because that is what a person expects when watching themselves move.
 */
export function SkeletonOverlay({
  video,
  frameRef,
  guideRef,
  deepEnoughRef,
  quality,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Mirror everything that follows.
      ctx.translate(width, 0);
      ctx.scale(-1, 1);

      if (video && video.readyState >= 2) {
        drawCover(ctx, video, width, height);
      } else {
        ctx.fillStyle = '#12100f';
        ctx.fillRect(0, 0, width, height);
      }

      const current = frameRef.current;
      if (current?.present && current.landmarks.length > 0) {
        drawSkeleton(ctx, current, width, height, qualityRef.current);
      }

      const guide = guideRef.current;
      if (guide && current?.present) {
        drawDepthGuide(ctx, guide, width, height, deepEnoughRef.current === true);
      }

      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  return <canvas ref={canvasRef} className="skeleton-canvas" />;
}

/** object-fit: cover, done by hand because the canvas has no CSS to lean on. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
): void {
  const videoRatio = video.videoWidth / video.videoHeight;
  const boxRatio = width / height;
  let drawWidth = width;
  let drawHeight = height;
  let offsetX = 0;
  let offsetY = 0;

  if (videoRatio > boxRatio) {
    drawWidth = height * videoRatio;
    offsetX = (width - drawWidth) / 2;
  } else {
    drawHeight = width / videoRatio;
    offsetY = (height - drawHeight) / 2;
  }
  ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
}

/**
 * The depth guide: where the hips start, how far down they have to go, and
 * where they are right now.
 *
 * This exists because rep detection is otherwise invisible. When a rep does not
 * count the player has no way to know whether they were too shallow, out of
 * frame, or hitting a bug — so they conclude it is broken. A target you can
 * watch yourself cross turns "it didn't work" into "I didn't go deep enough".
 */
function drawDepthGuide(
  ctx: CanvasRenderingContext2D,
  guide: DepthGuide,
  width: number,
  height: number,
  deepEnough: boolean,
): void {
  const standing = guide.restY * height;
  const target = guide.targetY * height;
  const current = guide.currentY * height;

  ctx.save();

  // Standing reference, drawn quietly.
  ctx.strokeStyle = 'rgba(242, 237, 233, 0.28)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 7]);
  line(ctx, standing, width);

  // Depth target. Turns green the moment the rep is deep enough to count.
  ctx.strokeStyle = deepEnough ? 'rgba(74, 222, 128, 0.95)' : 'rgba(255, 214, 92, 0.75)';
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  line(ctx, target, width);

  // Live hip marker, tracing between the two.
  ctx.setLineDash([]);
  ctx.fillStyle = deepEnough ? 'rgba(74, 222, 128, 0.95)' : 'rgba(255, 92, 46, 0.95)';
  ctx.beginPath();
  ctx.arc(width / 2, current, 7, 0, Math.PI * 2);
  ctx.fill();

  // Labels are drawn unmirrored, or they read backwards.
  ctx.scale(-1, 1);
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(242, 237, 233, 0.5)';
  ctx.fillText('START', -width + 14, standing - 6);
  ctx.fillStyle = deepEnough ? 'rgba(74, 222, 128, 0.95)' : 'rgba(255, 214, 92, 0.9)';
  ctx.fillText(deepEnough ? 'GOOD — THAT COUNTS' : guide.label, -width + 14, target - 6);

  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, y: number, width: number): void {
  ctx.beginPath();
  ctx.moveTo(14, y);
  ctx.lineTo(width - 14, y);
  ctx.stroke();
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  width: number,
  height: number,
  quality: number,
): void {
  const alpha = 0.35 + 0.65 * Math.max(0, Math.min(1, quality));
  const points = frame.landmarks;

  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(255, 92, 46, ${alpha})`;

  for (const [a, b] of POSE_CONNECTIONS) {
    const pa = points[a];
    const pb = points[b];
    if (!pa || !pb) continue;
    if (pa.visibility < 0.4 || pb.visibility < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * width, pa.y * height);
    ctx.lineTo(pb.x * width, pb.y * height);
    ctx.stroke();
  }

  ctx.fillStyle = `rgba(255, 214, 92, ${alpha})`;
  for (const point of points) {
    if (point.visibility < 0.4) continue;
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
