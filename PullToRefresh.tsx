import { useEffect, useId, useRef, type ReactNode } from "react";
import "./PullToRefresh.css";

export interface PullToRefreshProps {
  /** Called on release past the threshold. The animation loops until it settles. */
  onRefresh: () => Promise<unknown> | void;
  children: ReactNode;
  /** Pull distance (px) that arms the refresh. */
  threshold?: number;
  /** Maximum visual pull distance (px). */
  maxPull?: number;
  /** "self": the component scrolls its own content (give it a height). "window": the page scrolls. */
  scroller?: "self" | "window";
  disabled?: boolean;
  /** Fired once when the threshold is crossed. Default: navigator.vibrate. Pass Capacitor Haptics here. */
  onThreshold?: () => void;
  /** Text announced to screen readers while refreshing. */
  loadingLabel?: string;
  className?: string;
}

const OUTLINE = "M693.33 353.56C692.15 351.76 691.08 349.96 689.5 348.44C683.12 342.3 666.21 334.6 657.57 328.82C640.77 317.56 627.29 301.13 619.97 282.24C602.42 236.93 623.48 196.4 641.8 155.56C650.39 136.41 657.92 116.7 667.5 98.02C679.66 74.31 698.05 48.51 727.96 50.08C752.11 51.35 770.81 69.35 781.22 89.92C791.4 110.07 795.59 132.49 800.85 154.25C809.32 189.28 818.64 218.56 811.5 255.26C807.07 278.08 796.98 299.77 781.47 317.18C776.19 323.09 753.78 342.23 752.06 346.93C750.28 351.8 758.83 353.44 761.92 353.65C773.4 354.45 785.48 348.79 795.24 343.3C821.67 328.44 842.06 303.73 846.99 273.31C853.09 235.58 841.04 198.79 829.9 163.27L818.24 125.48C808.05 92.76 795.67 60.24 762.7 44.45C754.81 40.67 746.29 37.9 737.61 36.69C705.55 32.22 683.13 49.24 666.63 75.14C653.87 95.15 644.72 117.31 634.55 138.69C614.54 180.8 591.56 224.71 602.35 272.8C608.85 301.79 627.91 327.43 652.9 343.2C661.97 348.93 673.23 354.87 684.23 354.88C687.33 354.89 690.33 354.21 693.33 353.56Z";
const REVEAL = "M700 357C668 352 630 318 611 277C606 235 620 192 635 148C646 125 655 105 667 87C682 66 705 47 733 43C758 41 778 62 792 100C800 122 808 140 815 159C822 195 833 230 828 264C823 292 808 315 788 330C778 342 768 350 760 355";
const X = 710.89, Y = 237.83, R = 51.83;
const MIN_LOADING_MS = 700;
const defaultHaptic = () => { try { navigator.vibrate?.(12); } catch { /* unsupported */ } };

export function PullToRefresh({
  onRefresh, children, threshold = 64, maxPull = 130, scroller = "self",
  disabled = false, onThreshold, loadingLabel = "جارٍ التحديث…", className,
}: PullToRefreshProps) {
  const maskId = `ptr-${useId().replace(/:/g, "")}`;
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLSpanElement>(null);
  const revealRef = useRef<SVGPathElement>(null);
  const pitRef = useRef<SVGCircleElement>(null);
  const cb = useRef({ onRefresh, onThreshold });
  cb.current = { onRefresh, onThreshold };

  useEffect(() => {
    const el = root.current, body = content.current, rev = revealRef.current, pit = pitRef.current, status = live.current;
    if (!el || !body || !rev || !pit || !status || disabled) return;

    const target: EventTarget = scroller === "window" ? document : body;
    const scrollTop = () => (scroller === "window" ? document.scrollingElement?.scrollTop ?? 0 : body.scrollTop);

    let state: "idle" | "pulling" | "loading" | "done" = "idle";
    let tracking = false, engaged = false, ready = false, x0 = 0, y0 = 0, pull = 0;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };

    const setPull = (v: number) => { pull = v; el.style.setProperty("--ptr-pull", `${v}px`); };
    const setProgress = (p: number) => {
      rev.style.strokeDashoffset = String(1 - p);
      pit.style.opacity = String(Math.min(1, p * 1.3));
      pit.style.transform = `scale(${0.5 + 0.5 * p})`;
    };
    const reset = () => {
      setPull(0);
      rev.style.strokeDashoffset = "";
      pit.style.opacity = "";
      pit.style.transform = "";
      state = "idle";
    };

    const drag = (dy: number) => {
      state = "pulling";
      el.classList.remove("ptr--snap");
      setPull(Math.min(Math.max(dy, 0) * 0.5, maxPull));
      setProgress(Math.min(pull / threshold, 1));
      if (pull >= threshold && !ready) {
        ready = true;
        el.classList.remove("ptr--pop");
        void el.offsetWidth;
        el.classList.add("ptr--pop");
        (cb.current.onThreshold ?? defaultHaptic)();
      } else if (pull < threshold && ready) {
        ready = false;
      }
    };

    const finish = () => {
      state = "done";
      el.classList.remove("ptr--loading");
      el.classList.add("ptr--settle");
      later(() => {
        setPull(0);
        later(() => {
          el.classList.remove("ptr--settle", "ptr--snap");
          rev.style.strokeDashoffset = "";
          status.textContent = "";
          state = "idle";
        }, 340);
      }, 520);
    };

    const load = async () => {
      state = "loading";
      ready = false;
      setPull(threshold);
      rev.style.strokeDashoffset = "0";
      pit.style.opacity = "";
      pit.style.transform = "";
      el.classList.remove("ptr--pop");
      el.classList.add("ptr--loading");
      status.textContent = loadingLabel;
      const t0 = Date.now();
      try { await cb.current.onRefresh(); } catch { /* the caller handles its own errors */ }
      later(finish, Math.max(0, MIN_LOADING_MS - (Date.now() - t0)));
    };

    const onStart = (e: TouchEvent) => {
      if (state === "loading" || state === "done" || scrollTop() > 0) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      tracking = true;
      engaged = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
      if (!engaged) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dy <= 0 || Math.abs(dx) > dy || scrollTop() > 0) { tracking = false; return; }
        engaged = true;
      }
      if (e.cancelable) e.preventDefault();
      drag(dy);
    };
    const onEnd = () => {
      tracking = false;
      if (state !== "pulling") return;
      el.classList.add("ptr--snap");
      if (ready) void load(); else reset();
    };

    target.addEventListener("touchstart", onStart as EventListener, { passive: true });
    target.addEventListener("touchmove", onMove as EventListener, { passive: false });
    target.addEventListener("touchend", onEnd);
    target.addEventListener("touchcancel", onEnd);
    return () => {
      target.removeEventListener("touchstart", onStart as EventListener);
      target.removeEventListener("touchmove", onMove as EventListener);
      target.removeEventListener("touchend", onEnd);
      target.removeEventListener("touchcancel", onEnd);
      timers.forEach(clearTimeout);
      el.classList.remove("ptr--pop", "ptr--loading", "ptr--settle", "ptr--snap");
      reset();
    };
  }, [disabled, scroller, threshold, maxPull, loadingLabel]);

  return (
    <div ref={root} className={`ptr${scroller === "window" ? " ptr--window" : ""}${className ? ` ${className}` : ""}`}>
      <div className="ptr__ind" aria-hidden="true">
        <svg viewBox="516.67 -12 414.88 414.88" focusable="false">
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x={500} y={-30} width={450} height={450}>
              <path ref={revealRef} className="ptr__reveal" pathLength={1} d={REVEAL} />
            </mask>
          </defs>
          <circle className="ptr__ring" cx={X} cy={Y} r={R} />
          <circle className="ptr__ring" cx={X} cy={Y} r={R} />
          <path className="ptr__o" mask={`url(#${maskId})`} fillRule="evenodd" d={OUTLINE} />
          <circle ref={pitRef} className="ptr__pit" cx={X} cy={Y} r={R} />
        </svg>
      </div>
      <div ref={content} className="ptr__content">{children}</div>
      <span ref={live} className="ptr__sr" role="status" aria-live="polite" />
    </div>
  );
}

export default PullToRefresh;
