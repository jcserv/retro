export const DROP_ATTRIBUTE = "data-drop";

const MOUSE_ACTIVATION_DISTANCE = 5;
const TOUCH_ACTIVATION_DELAY_MS = 250;
const TOUCH_TOLERANCE = 8;
const SCROLL_EDGE = 64;
const SCROLL_MAX_STEP = 18;
const INTERACTIVE = "button, input, textarea, select, a, [contenteditable], [data-no-drag]";

export type PointerDragOptions<S> = {
  canDrop(source: S, targetKey: string): boolean;
  onDrop(source: S, targetKey: string): void;
  ghostClass: string;
  inheritedProperties?: readonly string[];
};

export type PointerDrag<S> = {
  begin(event: PointerEvent, source: S, element: HTMLElement): void;
  cancel(): void;
};

type Session<S> = {
  source: S;
  element: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  ghost: HTMLElement | null;
  over: Element | null;
  overKey: string | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  frame: number | undefined;
  abort: () => void;
};

export function createPointerDrag<S>(options: PointerDragOptions<S>): PointerDrag<S> {
  let session: Session<S> | null = null;

  function begin(event: PointerEvent, source: S, element: HTMLElement): void {
    if (session || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;

    const touch = event.pointerType === "touch";
    const listeners = new AbortController();
    const current: Session<S> = {
      source,
      element,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      ghost: null,
      over: null,
      overKey: null,
      timer: undefined,
      frame: undefined,
      abort: () => end(false),
    };
    session = current;

    const { signal } = listeners;
    window.addEventListener("pointermove", onMove, { signal });
    window.addEventListener("pointerup", onUp, { signal });
    window.addEventListener("pointercancel", () => end(false), { signal });
    window.addEventListener("blur", () => end(false), { signal });
    window.addEventListener(
      "keydown",
      (keyEvent) => {
        if (keyEvent.key !== "Escape" || !current.active) return;
        keyEvent.preventDefault();
        end(false);
      },
      { signal, capture: true },
    );
    window.addEventListener(
      "touchmove",
      (touchEvent) => {
        if (current.active && touchEvent.cancelable) touchEvent.preventDefault();
      },
      { signal, passive: false },
    );
    window.addEventListener(
      "contextmenu",
      (menuEvent) => {
        if (touch) menuEvent.preventDefault();
      },
      { signal },
    );

    if (touch) current.timer = setTimeout(activate, TOUCH_ACTIVATION_DELAY_MS);

    function onMove(moveEvent: PointerEvent): void {
      if (moveEvent.pointerId !== current.pointerId) return;
      current.x = moveEvent.clientX;
      current.y = moveEvent.clientY;
      const distance = Math.hypot(current.x - current.startX, current.y - current.startY);
      if (!current.active) {
        if (touch) {
          if (distance > TOUCH_TOLERANCE) end(false);
        } else if (distance > MOUSE_ACTIVATION_DISTANCE) {
          activate();
        }
        return;
      }
      moveEvent.preventDefault();
      track();
    }

    function onUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId !== current.pointerId) return;
      end(true);
    }

    function activate(): void {
      if (session !== current || current.active) return;
      current.active = true;
      const rect = element.getBoundingClientRect();
      const ghost = element.cloneNode(true) as HTMLElement;
      ghost.removeAttribute(DROP_ATTRIBUTE);
      for (const node of ghost.querySelectorAll("[id]")) node.removeAttribute("id");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.classList.add(options.ghostClass);
      const computed = getComputedStyle(element);
      for (const property of options.inheritedProperties ?? []) {
        ghost.style.setProperty(property, computed.getPropertyValue(property));
      }
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        margin: "0",
        pointerEvents: "none",
      });
      document.body.append(ghost);
      current.ghost = ghost;
      element.dataset.dragging = "true";
      document.documentElement.dataset.dragging = "true";
      window.getSelection()?.removeAllRanges();
      track();
      current.frame = requestAnimationFrame(autoScroll);
    }

    function track(): void {
      const ghost = current.ghost;
      if (!ghost) return;
      ghost.style.transform = `translate(${current.x - current.startX}px, ${current.y - current.startY}px)`;
      const hit = document.elementFromPoint(current.x, current.y)?.closest(`[${DROP_ATTRIBUTE}]`);
      const key = hit?.getAttribute(DROP_ATTRIBUTE) ?? null;
      const valid = hit && key && options.canDrop(current.source, key) ? hit : null;
      if (valid === current.over) return;
      current.over?.removeAttribute("data-drop-over");
      valid?.setAttribute("data-drop-over", "true");
      current.over = valid;
      current.overKey = valid ? key : null;
    }

    function autoScroll(): void {
      if (session !== current) return;
      const { innerHeight } = window;
      let step = 0;
      if (current.y < SCROLL_EDGE) step = -edgeSpeed(current.y);
      else if (current.y > innerHeight - SCROLL_EDGE) step = edgeSpeed(innerHeight - current.y);
      if (step !== 0) {
        window.scrollBy(0, step);
        track();
      }
      current.frame = requestAnimationFrame(autoScroll);
    }

    function end(drop: boolean): void {
      if (session !== current) return;
      session = null;
      clearTimeout(current.timer);
      if (current.frame !== undefined) cancelAnimationFrame(current.frame);
      listeners.abort();
      const { active, overKey } = current;
      current.ghost?.remove();
      current.over?.removeAttribute("data-drop-over");
      delete element.dataset.dragging;
      delete document.documentElement.dataset.dragging;
      if (!active) return;
      suppressNextClick();
      if (drop && overKey !== null && options.canDrop(current.source, overKey)) {
        options.onDrop(current.source, overKey);
      }
    }
  }

  return {
    begin,
    cancel: () => session?.abort(),
  };
}

function edgeSpeed(distanceFromEdge: number): number {
  const ratio = 1 - Math.max(0, distanceFromEdge) / SCROLL_EDGE;
  return Math.ceil(ratio * SCROLL_MAX_STEP);
}

function suppressNextClick(): void {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}
