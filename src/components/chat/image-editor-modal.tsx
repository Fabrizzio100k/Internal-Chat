"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Crop,
  RotateCw,
  RotateCcw,
  FlipHorizontal2,
  FlipVertical2,
  Pencil,
  Highlighter,
  Undo2,
  Redo2,
  Check,
  X,
  Loader2,
  Sparkles,
  Eraser,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tool = "draw" | "highlight" | "crop";

type Filter = {
  id: string;
  label: string;
  css: string;
};

const FILTERS: Filter[] = [
  { id: "none", label: "Original", css: "none" },
  { id: "grayscale", label: "B/N", css: "grayscale(1)" },
  { id: "sepia", label: "Sepia", css: "sepia(0.8)" },
  { id: "warm", label: "Cálido", css: "saturate(1.4) sepia(0.25) contrast(1.05)" },
  { id: "cool", label: "Frío", css: "saturate(1.2) hue-rotate(-15deg) brightness(1.05)" },
  { id: "vivid", label: "Vívido", css: "saturate(1.8) contrast(1.15)" },
  { id: "bright", label: "Brillo", css: "brightness(1.25) contrast(1.05)" },
  { id: "dark", label: "Oscuro", css: "brightness(0.8) contrast(1.15)" },
  { id: "invert", label: "Invertir", css: "invert(1)" },
];

const DRAW_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#000000", "#ffffff"];

type Stroke = {
  tool: "draw" | "highlight";
  color: string;
  size: number;
  points: { x: number; y: number }[];
};

type CropRect = { x: number; y: number; w: number; h: number };

/**
 * Editor de imágenes sobre canvas, estilo WhatsApp: recortar, rotar, voltear,
 * aplicar filtros y dibujar / resaltar a mano alzada. Trabaja sobre las
 * dimensiones reales de la imagen y devuelve un nuevo File al confirmar.
 *
 * Arquitectura:
 * - `baseCanvasRef` mantiene los píxeles "confirmados" (imagen + operaciones
 *   destructivas ya aplicadas: rotación, flip, filtro, recorte, trazos).
 * - `history` guarda snapshots (ImageData) para deshacer/rehacer.
 * - Los trazos en curso se dibujan en un canvas de overlay y se commitean al
 *   soltar el mouse.
 */
export function ImageEditorModal({
  open,
  file,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  file: File | null;
  onCancel: () => void;
  onConfirm: (edited: File) => void;
}) {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<Tool>("draw");
  const [color, setColor] = useState(DRAW_COLORS[4]);
  const [brushSize, setBrushSize] = useState(6);
  const [activeFilter, setActiveFilter] = useState("none");
  const [isReady, setIsReady] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Historial de snapshots del canvas base.
  const historyRef = useRef<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyLen, setHistoryLen] = useState(0);

  // Escala de visualización (canvas real -> pantalla) para mapear coordenadas.
  const [displayScale, setDisplayScale] = useState(1);
  // Dimensiones reales del canvas base, en estado (no leemos el ref en render).
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);

  // Estado del trazo/recorte en curso.
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const cropRef = useRef<CropRect | null>(null);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);

  const pushHistory = useCallback(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Trunca cualquier "rehacer" pendiente al crear una nueva rama.
    const next = historyRef.current.slice(0, historyIndex + 1);
    next.push(snapshot);
    historyRef.current = next;
    setHistoryIndex(next.length - 1);
    setHistoryLen(next.length);
  }, [historyIndex]);

  const fitDisplay = useCallback(() => {
    const canvas = baseCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const maxW = container.clientWidth;
    const maxH = container.clientHeight;
    setCanvasSize({ w: canvas.width, h: canvas.height });
    if (maxW === 0 || maxH === 0) return;
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
    setDisplayScale(scale);
  }, []);

  // Carga inicial de la imagen en el canvas base.
  useEffect(() => {
    if (!open || !file) return;
    // Reset de refs (permitido) y de estado fuera del cuerpo síncrono del
    // efecto para no disparar renders en cascada.
    cropRef.current = null;
    cropStartRef.current = null;
    historyRef.current = [];
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setIsReady(false);
      setActiveFilter("none");
      setCropRect(null);
      setHistoryIndex(-1);
      setHistoryLen(0);
    });

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = baseCanvasRef.current;
      const overlay = overlayCanvasRef.current;
      if (!canvas || !overlay) return;
      // Limita el tamaño máximo del canvas para no reventar memoria con fotos enormes.
      const MAX_DIM = 2000;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      overlay.width = width;
      overlay.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      // history inicial
      const snapshot = ctx.getImageData(0, 0, width, height);
      historyRef.current = [snapshot];
      setIsReady(true);
      setHistoryIndex(0);
      setHistoryLen(1);
      requestAnimationFrame(fitDisplay);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (!cancelled) setIsReady(false);
    };
    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [open, file, fitDisplay]);

  useEffect(() => {
    if (!open) return;
    const handler = () => fitDisplay();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [open, fitDisplay]);

  const restoreSnapshot = useCallback((index: number) => {
    const canvas = baseCanvasRef.current;
    const snapshot = historyRef.current[index];
    if (!canvas || !snapshot) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (canvas.width !== snapshot.width || canvas.height !== snapshot.height) {
      canvas.width = snapshot.width;
      canvas.height = snapshot.height;
      const overlay = overlayCanvasRef.current;
      if (overlay) {
        overlay.width = snapshot.width;
        overlay.height = snapshot.height;
      }
    }
    ctx.putImageData(snapshot, 0, 0);
    requestAnimationFrame(fitDisplay);
  }, [fitDisplay]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const idx = historyIndex - 1;
    setHistoryIndex(idx);
    restoreSnapshot(idx);
  }, [historyIndex, restoreSnapshot]);

  const redo = useCallback(() => {
    if (historyIndex >= historyRef.current.length - 1) return;
    const idx = historyIndex + 1;
    setHistoryIndex(idx);
    restoreSnapshot(idx);
  }, [historyIndex, restoreSnapshot]);

  // --- Operaciones destructivas: rotar / voltear ---

  const applyTransform = useCallback(
    (kind: "rotate-cw" | "rotate-ccw" | "flip-h" | "flip-v") => {
      const canvas = baseCanvasRef.current;
      const overlay = overlayCanvasRef.current;
      if (!canvas || !overlay) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { width, height } = canvas;
      const tmp = document.createElement("canvas");
      const tctx = tmp.getContext("2d");
      if (!tctx) return;

      if (kind === "rotate-cw" || kind === "rotate-ccw") {
        tmp.width = height;
        tmp.height = width;
        tctx.save();
        if (kind === "rotate-cw") {
          tctx.translate(height, 0);
          tctx.rotate(Math.PI / 2);
        } else {
          tctx.translate(0, width);
          tctx.rotate(-Math.PI / 2);
        }
        tctx.drawImage(canvas, 0, 0);
        tctx.restore();
        canvas.width = tmp.width;
        canvas.height = tmp.height;
        overlay.width = tmp.width;
        overlay.height = tmp.height;
      } else {
        tmp.width = width;
        tmp.height = height;
        tctx.save();
        if (kind === "flip-h") {
          tctx.translate(width, 0);
          tctx.scale(-1, 1);
        } else {
          tctx.translate(0, height);
          tctx.scale(1, -1);
        }
        tctx.drawImage(canvas, 0, 0);
        tctx.restore();
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(tmp, 0, 0);
      pushHistory();
      requestAnimationFrame(fitDisplay);
    },
    [pushHistory, fitDisplay],
  );

  // --- Filtros: se aplican de forma destructiva sobre el canvas base ---

  const applyFilter = useCallback(
    (filter: Filter) => {
      setActiveFilter(filter.id);
      const canvas = baseCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (filter.css === "none") return; // "Original" no re-aplica sobre lo ya pintado
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext("2d");
      if (!tctx) return;
      tctx.drawImage(canvas, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.filter = filter.css;
      ctx.drawImage(tmp, 0, 0);
      ctx.filter = "none";
      pushHistory();
    },
    [pushHistory],
  );

  // --- Mapeo de coordenadas de pantalla a píxeles del canvas ---

  const toCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const overlay = overlayCanvasRef.current;
      if (!overlay) return { x: 0, y: 0 };
      const rect = overlay.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * overlay.width;
      const y = ((clientY - rect.top) / rect.height) * overlay.height;
      return { x, y };
    },
    [],
  );

  const redrawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const octx = overlay.getContext("2d");
    if (!octx) return;
    octx.clearRect(0, 0, overlay.width, overlay.height);

    // Trazo en curso.
    const stroke = currentStrokeRef.current;
    if (stroke && stroke.points.length > 0) {
      drawStroke(octx, stroke);
    }

    // Rectángulo de recorte.
    const crop = cropRef.current;
    if (crop) {
      octx.save();
      octx.fillStyle = "rgba(0,0,0,0.45)";
      octx.fillRect(0, 0, overlay.width, overlay.height);
      octx.clearRect(crop.x, crop.y, crop.w, crop.h);
      octx.strokeStyle = "#ffffff";
      octx.lineWidth = Math.max(2, overlay.width / 400);
      octx.setLineDash([8, 6]);
      octx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      octx.restore();
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isReady) return;
      const overlay = overlayCanvasRef.current;
      if (!overlay) return;
      overlay.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      const { x, y } = toCanvasCoords(e.clientX, e.clientY);

      if (tool === "crop") {
        cropStartRef.current = { x, y };
        cropRef.current = { x, y, w: 0, h: 0 };
      } else {
        currentStrokeRef.current = {
          tool,
          color,
          size: brushSize * (tool === "highlight" ? 3 : 1),
          points: [{ x, y }],
        };
      }
      redrawOverlay();
    },
    [isReady, tool, color, brushSize, toCanvasCoords, redrawOverlay],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const { x, y } = toCanvasCoords(e.clientX, e.clientY);

      if (tool === "crop") {
        const start = cropStartRef.current;
        if (!start) return;
        cropRef.current = {
          x: Math.min(start.x, x),
          y: Math.min(start.y, y),
          w: Math.abs(x - start.x),
          h: Math.abs(y - start.y),
        };
      } else {
        currentStrokeRef.current?.points.push({ x, y });
      }
      redrawOverlay();
    },
    [tool, toCanvasCoords, redrawOverlay],
  );

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;

    if (tool === "crop") {
      const crop = cropRef.current;
      if (crop && crop.w > 8 && crop.h > 8) {
        setCropRect({ ...crop });
      } else {
        cropRef.current = null;
        setCropRect(null);
      }
      redrawOverlay();
      return;
    }

    // Commit del trazo al canvas base.
    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (stroke && stroke.points.length > 0) {
      const canvas = baseCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) {
        drawStroke(ctx, stroke);
        pushHistory();
      }
    }
    redrawOverlay();
  }, [tool, pushHistory, redrawOverlay]);

  const confirmCrop = useCallback(() => {
    const crop = cropRef.current ?? cropRect;
    const canvas = baseCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!crop || !canvas || !overlay) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sx = Math.round(crop.x);
    const sy = Math.round(crop.y);
    const sw = Math.round(crop.w);
    const sh = Math.round(crop.h);
    if (sw < 1 || sh < 1) return;

    const cropped = ctx.getImageData(sx, sy, sw, sh);
    canvas.width = sw;
    canvas.height = sh;
    overlay.width = sw;
    overlay.height = sh;
    ctx.putImageData(cropped, 0, 0);

    cropRef.current = null;
    setCropRect(null);
    pushHistory();
    setTool("draw");
    requestAnimationFrame(fitDisplay);
    redrawOverlay();
  }, [cropRect, pushHistory, fitDisplay, redrawOverlay]);

  const cancelCrop = useCallback(() => {
    cropRef.current = null;
    setCropRect(null);
    redrawOverlay();
  }, [redrawOverlay]);

  const handleConfirm = useCallback(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas || !file) return;
    setIsExporting(true);
    const isPng = file.type === "image/png" || /\.png$/i.test(file.name);
    const mime = isPng ? "image/png" : "image/jpeg";
    canvas.toBlob(
      (blob) => {
        setIsExporting(false);
        if (!blob) return;
        const baseName = file.name.replace(/\.[^.]+$/, "");
        const ext = isPng ? "png" : "jpg";
        const edited = new File([blob], `${baseName}-editado.${ext}`, { type: mime });
        onConfirm(edited);
      },
      mime,
      0.92,
    );
  }, [file, onConfirm]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyLen - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-3xl" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-1">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Editar imagen
            </DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={undo}
                disabled={!canUndo}
                aria-label="Deshacer"
              >
                <Undo2 />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={redo}
                disabled={!canRedo}
                aria-label="Rehacer"
              >
                <Redo2 />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Barra de herramientas */}
        <div className="flex flex-wrap items-center gap-1.5">
          <ToolButton active={tool === "draw"} onClick={() => setTool("draw")} icon={<Pencil />} label="Dibujar" />
          <ToolButton
            active={tool === "highlight"}
            onClick={() => setTool("highlight")}
            icon={<Highlighter />}
            label="Resaltar"
          />
          <ToolButton active={tool === "crop"} onClick={() => setTool("crop")} icon={<Crop />} label="Recortar" />
          <div className="mx-1 h-6 w-px bg-border" />
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyTransform("rotate-ccw")} aria-label="Rotar izquierda">
            <RotateCcw />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyTransform("rotate-cw")} aria-label="Rotar derecha">
            <RotateCw />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyTransform("flip-h")} aria-label="Voltear horizontal">
            <FlipHorizontal2 />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyTransform("flip-v")} aria-label="Voltear vertical">
            <FlipVertical2 />
          </Button>
        </div>

        {/* Colores y grosor (solo para dibujo/resaltado) */}
        <AnimatePresence initial={false}>
          {tool !== "crop" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="flex flex-wrap items-center gap-2 overflow-hidden"
            >
              <div className="flex items-center gap-1">
                {DRAW_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    className={cn(
                      "size-6 rounded-full border transition-transform hover:scale-110",
                      color === c && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Grosor</span>
                <input
                  type="range"
                  min={2}
                  max={24}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-24 accent-primary"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Área del canvas */}
        <div
          ref={containerRef}
          className="relative flex min-h-[240px] flex-1 items-center justify-center overflow-hidden rounded-lg border bg-[repeating-conic-gradient(#00000008_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-2"
        >
          {!isReady && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando imagen...
            </div>
          )}
          <div className="relative" style={{ lineHeight: 0 }}>
            <canvas
              ref={baseCanvasRef}
              style={{
                width: canvasSize ? canvasSize.w * displayScale : undefined,
                height: canvasSize ? canvasSize.h * displayScale : undefined,
              }}
              className="max-w-full rounded"
            />
            <canvas
              ref={overlayCanvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{
                width: canvasSize ? canvasSize.w * displayScale : undefined,
                height: canvasSize ? canvasSize.h * displayScale : undefined,
                cursor: "crosshair",
                touchAction: "none",
              }}
              className="absolute left-0 top-0 max-w-full rounded"
            />
          </div>

          {/* Controles de recorte */}
          <AnimatePresence>
            {cropRect && cropRect.w > 8 && cropRect.h > 8 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-2 py-1 shadow-lg backdrop-blur"
              >
                <Button type="button" size="sm" variant="ghost" onClick={cancelCrop} className="h-7 gap-1 rounded-full text-xs">
                  <Eraser className="size-3.5" /> Cancelar
                </Button>
                <Button type="button" size="sm" onClick={confirmCrop} className="h-7 gap-1 rounded-full text-xs">
                  <Check className="size-3.5" /> Recortar
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => applyFilter(f)}
              className={cn(
                "flex shrink-0 flex-col items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                activeFilter === f.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Acciones */}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onCancel} className="gap-1.5">
            <X className="size-4" /> Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!isReady || isExporting} className="gap-1.5">
            {isExporting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Aplicar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      <span className="[&_svg]:size-4">{icon}</span>
      {label}
    </button>
  );
}

/** Dibuja un trazo suavizado en el contexto dado. */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  if (stroke.tool === "highlight") {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = "multiply";
  }
  ctx.beginPath();
  const [first, ...rest] = stroke.points;
  ctx.moveTo(first.x, first.y);
  if (rest.length === 0) {
    // Un solo punto: dibuja un punto.
    ctx.lineTo(first.x + 0.1, first.y + 0.1);
  } else {
    for (const p of rest) {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}
