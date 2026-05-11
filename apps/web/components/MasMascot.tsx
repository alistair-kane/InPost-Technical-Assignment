"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** Paths from InPost `mas.svg` (yellow face, eyes, smile). */
const D_BG =
  "M50 0H0V50H50V0Z";
const D_RIGHT_WHITE =
  "M44.6301 14.6088C43.2467 13.2254 41.4842 12.2834 39.5654 11.9018C37.6466 11.5201 35.6578 11.716 33.8504 12.4647C32.0429 13.2134 30.4981 14.4812 29.4112 16.1079C28.3243 17.7346 27.7441 19.647 27.7441 21.6034C27.7441 23.5598 28.3243 25.4722 29.4112 27.0988C30.4981 28.7255 32.0429 29.9934 33.8504 30.7421C35.6578 31.4908 37.6466 31.6867 39.5654 31.3051C41.4842 30.9234 43.2467 29.9813 44.6301 28.5979C45.5487 27.6794 46.2774 26.589 46.7745 25.3888C47.2716 24.1887 47.5275 22.9024 47.5275 21.6034C47.5275 20.3044 47.2716 19.018 46.7745 17.8179C46.2774 16.6178 45.5487 15.5273 44.6301 14.6088Z";
const D_RIGHT_PUPIL =
  "M43.2868 16.0279C42.7681 15.5095 42.1073 15.1565 41.388 15.0136C40.6687 14.8707 39.9232 14.9443 39.2457 15.225C38.5683 15.5057 37.9892 15.9811 37.5818 16.5909C37.1744 17.2006 36.957 17.9175 36.957 18.6509C36.957 19.3842 37.1744 20.1011 37.5818 20.7109C37.9892 21.3207 38.5683 21.796 39.2457 22.0767C39.9232 22.3574 40.6687 22.431 41.388 22.2881C42.1073 22.1452 42.7681 21.7922 43.2868 21.2738C43.9821 20.5779 44.3726 19.6346 44.3726 18.6509C44.3726 17.6672 43.9821 16.7237 43.2868 16.0279Z";
const D_LEFT_WHITE =
  "M19.512 14.6087C18.1286 13.2255 16.3661 12.2836 14.4474 11.902C12.5287 11.5205 10.54 11.7164 8.73271 12.4651C6.92539 13.2137 5.38064 14.4816 4.29382 16.1082C3.20701 17.7347 2.62695 19.6471 2.62695 21.6034C2.62695 23.5596 3.20701 25.4719 4.29382 27.0984C5.38064 28.725 6.92539 29.9929 8.73271 30.7415C10.54 31.4902 12.5287 31.6861 14.4474 31.3046C16.3661 30.923 18.1286 29.9811 19.512 28.5979C20.4306 27.6794 21.1594 26.589 21.6565 25.3889C22.1537 24.1887 22.4096 22.9024 22.4096 21.6034C22.4096 20.3043 22.1537 19.0179 21.6565 17.8177C21.1594 16.6176 20.4306 15.5272 19.512 14.6087Z";
const D_LEFT_PUPIL =
  "M17.6169 16.0279C17.0982 15.5095 16.4374 15.1565 15.7182 15.0136C14.9989 14.8707 14.2533 14.9443 13.5758 15.225C12.8983 15.5057 12.3193 15.9811 11.9119 16.5909C11.5045 17.2006 11.2871 17.9175 11.2871 18.6509C11.2871 19.3842 11.5045 20.1011 11.9119 20.7109C12.3193 21.3207 12.8983 21.796 13.5758 22.0767C14.2533 22.3574 14.9989 22.431 15.7182 22.2881C16.4374 22.1452 17.0982 21.7922 17.6169 21.2738C18.3123 20.578 18.7029 19.6346 18.7029 18.6509C18.7029 17.6672 18.3123 16.7237 17.6169 16.0279Z";
const D_MOUTH =
  "M19.9609 33.0405C21.4559 34.274 23.3336 34.9487 25.2717 34.9487C27.2099 34.9487 29.0876 34.274 30.5826 33.0405L31.3705 33.9926C29.6541 35.4096 27.4979 36.1847 25.2722 36.1847C23.0464 36.1847 20.8902 35.4096 19.1738 33.9926L19.9609 33.0405Z";

const MAX_SHIFT = 3.15;

/** Between blinks (ms); loosely human-like variation. */
const BLINK_AFTER_MIN_MS = 2200;
const BLINK_AFTER_MAX_MS = 5200;
/** Eyelids shut duration (ms). */
const BLINK_SHUT_MS = 120;
/** Vertical squash at rest = 1; shut ≈ line (face reads as blink). */
const BLINK_SCALE_Y = 0.06;
const EYE_ORIGIN_X = 25;
const EYE_ORIGIN_Y = 21;

type EyeKey = "l" | "r";

type MasMascotProps = {
  className?: string;
  /** Outer pixel size (square); viewBox stays 0 0 50 50. */
  size?: number;
};

export function MasMascot({ className = "", size = 44 }: MasMascotProps) {
  const reactId = useId().replace(/:/g, "");
  const clipL = `mas-${reactId}-clip-l`;
  const clipR = `mas-${reactId}-clip-r`;

  const svgRef = useRef<SVGSVGElement>(null);
  const leftWhiteRef = useRef<SVGPathElement>(null);
  const rightWhiteRef = useRef<SVGPathElement>(null);
  const leftPupilGRef = useRef<SVGGElement>(null);
  const rightPupilGRef = useRef<SVGGElement>(null);

  const centersRef = useRef<Record<EyeKey, { cx: number; cy: number }>>({
    l: { cx: 14.8, cy: 21.6 },
    r: { cx: 37.6, cy: 21.6 },
  });

  const rafRef = useRef<number>(0);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  const [eyesShut, setEyesShut] = useState(false);
  const blinkWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkShutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const clearBlinkTimers = () => {
      if (blinkWaitRef.current != null) {
        clearTimeout(blinkWaitRef.current);
        blinkWaitRef.current = null;
      }
      if (blinkShutRef.current != null) {
        clearTimeout(blinkShutRef.current);
        blinkShutRef.current = null;
      }
    };

    const scheduleNextBlink = () => {
      if (cancelled) {
        return;
      }
      const gap =
        BLINK_AFTER_MIN_MS +
        Math.random() * (BLINK_AFTER_MAX_MS - BLINK_AFTER_MIN_MS);
      blinkWaitRef.current = setTimeout(() => {
        if (cancelled) {
          return;
        }
        setEyesShut(true);
        blinkShutRef.current = setTimeout(() => {
          if (cancelled) {
            return;
          }
          setEyesShut(false);
          scheduleNextBlink();
        }, BLINK_SHUT_MS);
      }, gap);
    };

    scheduleNextBlink();
    return () => {
      cancelled = true;
      clearBlinkTimers();
    };
  }, []);

  useLayoutEffect(() => {
    const lw = leftWhiteRef.current;
    const rw = rightWhiteRef.current;
    if (!lw || !rw) {
      return;
    }
    const lb = lw.getBBox();
    const rb = rw.getBBox();
    centersRef.current = {
      l: { cx: lb.x + lb.width / 2, cy: lb.y + lb.height / 2 },
      r: { cx: rb.x + rb.width / 2, cy: rb.y + rb.height / 2 },
    };
  }, []);

  const applyPupils = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const gL = leftPupilGRef.current;
    const gR = rightPupilGRef.current;
    if (!svg || !gL || !gR) {
      return;
    }
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return;
    }
    const inv = ctm.inverse();
    const p = pt.matrixTransform(inv);

    const setShift = (key: EyeKey, g: SVGGElement) => {
      const c = centersRef.current[key];
      let dx = p.x - c.cx;
      let dy = p.y - c.cy;
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.min(MAX_SHIFT / len, 1);
      dx *= t;
      dy *= t;
      g.setAttribute("transform", `translate(${dx},${dy})`);
    };

    setShift("l", gL);
    setShift("r", gR);
  }, []);

  useLayoutEffect(() => {
    const flush = () => {
      rafRef.current = 0;
      const pending = pendingRef.current;
      if (pending) {
        applyPupils(pending.x, pending.y);
      }
    };

    const onMove = (e: MouseEvent) => {
      pendingRef.current = { x: e.clientX, y: e.clientY };
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flush);
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [applyPupils]);

  return (
    <div className={`shrink-0 leading-none ${className}`.trim()}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox="0 0 50 50"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="pointer-events-none block drop-shadow-md"
        role="img"
        aria-label="InPost mascot"
      >
        <defs>
          <clipPath id={clipL}>
            <path d={D_LEFT_WHITE} />
          </clipPath>
          <clipPath id={clipR}>
            <path d={D_RIGHT_WHITE} />
          </clipPath>
        </defs>
        <path d={D_BG} fill="#FFCC04" />
        <g
          transform={
            eyesShut
              ? `translate(${EYE_ORIGIN_X} ${EYE_ORIGIN_Y}) scale(1 ${BLINK_SCALE_Y}) translate(${-EYE_ORIGIN_X} ${-EYE_ORIGIN_Y})`
              : undefined
          }
        >
          <path ref={rightWhiteRef} d={D_RIGHT_WHITE} fill="white" />
          <g clipPath={`url(#${clipR})`}>
            <g ref={rightPupilGRef}>
              <path d={D_RIGHT_PUPIL} fill="#494444" />
            </g>
          </g>
          <path ref={leftWhiteRef} d={D_LEFT_WHITE} fill="white" />
          <g clipPath={`url(#${clipL})`}>
            <g ref={leftPupilGRef}>
              <path d={D_LEFT_PUPIL} fill="#494444" />
            </g>
          </g>
        </g>
        <path d={D_MOUTH} fill="white" />
      </svg>
    </div>
  );
}
