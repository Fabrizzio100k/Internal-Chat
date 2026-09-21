"use client";

import { useEffect, useRef } from "react";
import { useUnreadTotal } from "@/hooks/use-unread-total";

const FAVICON_SIZE = 64;
const ORIGINAL_FAVICON_HREF = "/favicon.ico";

/**
 * Dibuja un badge numérico (rojo, con el conteo de no leídos) sobre el
 * favicon real de la app y lo aplica dinámicamente al <link rel="icon">,
 * además de anteponer "(N) " al <title> de la pestaña. Ambos se revierten
 * al estado original cuando totalUnread vuelve a 0.
 */
export function FaviconBadge() {
  const { totalUnread } = useUnreadTotal();
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const baseTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!baseImageRef.current) {
      const img = new Image();
      img.src = ORIGINAL_FAVICON_HREF;
      baseImageRef.current = img;
    }
    if (baseTitleRef.current === null) {
      baseTitleRef.current = document.title;
    }
  }, []);

  useEffect(() => {
    const baseTitle = baseTitleRef.current ?? document.title;
    document.title = totalUnread > 0 ? `(${totalUnread > 99 ? "99+" : totalUnread}) ${baseTitle}` : baseTitle;
  }, [totalUnread]);

  useEffect(() => {
    const img = baseImageRef.current;
    if (!img) return;

    const applyBadge = () => {
      const canvas = document.createElement("canvas");
      canvas.width = FAVICON_SIZE;
      canvas.height = FAVICON_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
      ctx.drawImage(img, 0, 0, FAVICON_SIZE, FAVICON_SIZE);

      if (totalUnread > 0) {
        const label = totalUnread > 99 ? "99+" : String(totalUnread);
        const radius = label.length > 2 ? 20 : 16;
        const cx = FAVICON_SIZE - radius - 2;
        const cy = radius + 2;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = "#ef4444";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${label.length > 2 ? 18 : 22}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, cx, cy + 1);
      }

      updateFaviconLink(canvas.toDataURL("image/png"));
    };

    if (img.complete) {
      applyBadge();
    } else {
      img.onload = applyBadge;
    }
  }, [totalUnread]);

  return null;
}

function updateFaviconLink(href: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}
