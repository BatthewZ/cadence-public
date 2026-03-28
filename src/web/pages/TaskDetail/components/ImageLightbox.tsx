import { X } from "lucide-react";

import { Portal } from "@/web/components/ui";
import type { Attachment } from "@/web/hooks/use-task-attachments";

export function ImageLightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
}: {
  images: Attachment[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const current = images[currentIndex];
  if (!current) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowLeft" && currentIndex > 0) onNavigate(currentIndex - 1);
    if (e.key === "ArrowRight" && currentIndex < images.length - 1) onNavigate(currentIndex + 1);
  };

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        ref={(el) => el?.focus()}
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X size={20} />
        </button>

        <img
          src={current.url}
          alt={current.filename}
          className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />

        {/* Navigation indicators */}
        {images.length > 1 && (
          <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2">
            {images.map((_, i) => (
              <button
                key={images[i].id}
                type="button"
                className={`size-2 rounded-full transition-colors ${i === currentIndex ? "bg-white" : "bg-white/40 hover:bg-white/60"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate(i);
                }}
                aria-label={`View image ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </Portal>
  );
}
