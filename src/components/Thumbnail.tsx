import { useEffect, useRef, useState } from "react";
import type { Asset } from "../lib/types";
import { fileBlob } from "../lib/api";

export function Thumbnail({ asset }: { asset: Asset }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    let started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((e) => e.isIntersecting)) return;
        started = true;
        fileBlob(asset)
          .then((blob) => {
            url = URL.createObjectURL(blob);
            if (active) setSrc(url);
            else URL.revokeObjectURL(url);
          })
          .catch(() => {});
      },
      { rootMargin: "100px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      active = false;
      observer.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset.id]);
  return (
    <span ref={ref} className="record-thumbnail">
      {src ? (
        <img src={src} alt="첨부 사진 미리보기" loading="lazy" />
      ) : (
        <span>사진</span>
      )}
    </span>
  );
}
