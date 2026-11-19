"use client";

import { useEffect, useRef } from "react";

/** Wraps the embedded form and reports its content height to the parent page (see public/embed.js). */
export function EmbedResizer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.parent === window) return;
    let last = -1;
    const post = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      // Height is not sensitive; the parent's origin is unknown, and embed.js checks ours.
      window.parent.postMessage({ type: "gbys:contact:height", height }, "*");
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(el);
    window.addEventListener("resize", post);
    window.addEventListener("load", post);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", post);
      window.removeEventListener("load", post);
    };
  }, []);
  return <div ref={ref}>{children}</div>;
}
