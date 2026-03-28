import { useCallback, useRef, useState } from "react";

import { api, ApiError } from "@/web/lib/api/client";
import { formatBytes } from "@/web/util/format";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type UploadState = "idle" | "uploading" | "success" | "error";

type UploadMethod = "post" | "put";

interface FileConstraints {
  /** Accepted MIME types. If empty or undefined, all types are allowed. */
  accept?: readonly string[];
  /** Maximum file size in bytes. */
  maxSize?: number;
}

interface UploadOptions {
  /** API endpoint to upload to. */
  endpoint: string;
  /** HTTP method — defaults to `"put"`. */
  method?: UploadMethod;
  /** FormData field name — defaults to `"file"`. */
  fieldName?: string;
}

interface ValidationError {
  type: "invalid-type" | "file-too-large";
  message: string;
}

interface UseFileUploadReturn<T = unknown> {
  state: UploadState;
  error: string | null;
  data: T | null;
  upload: (file: File, options: UploadOptions) => Promise<T | null>;
  cancel: () => void;
  validate: (file: File, constraints: FileConstraints) => ValidationError | null;
  reset: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useFileUpload<T = unknown>(): UseFileUploadReturn<T> {
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const validate = useCallback(
    (file: File, constraints: FileConstraints): ValidationError | null => {
      if (constraints.accept && constraints.accept.length > 0) {
        if (!constraints.accept.includes(file.type)) {
          return {
            type: "invalid-type",
            message: `File type "${file.type || "unknown"}" is not allowed. Accepted types: ${constraints.accept.join(", ")}.`,
          };
        }
      }

      if (constraints.maxSize != null && file.size > constraints.maxSize) {
        return {
          type: "file-too-large",
          message: `File is too large (${formatBytes(file.size)}). Maximum size is ${formatBytes(constraints.maxSize)}.`,
        };
      }

      return null;
    },
    [],
  );

  const upload = useCallback(
    async (file: File, options: UploadOptions): Promise<T | null> => {
      // Cancel any in-flight upload.
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      const formData = new FormData();
      formData.append(options.fieldName ?? "file", file);

      setState("uploading");
      setError(null);
      setData(null);

      try {
        const method = options.method ?? "put";
        const result = await api[method]<T>(options.endpoint, formData, {
          signal: controller.signal,
        });

        if (!controller.signal.aborted) {
          setState("success");
          setData(result);
          return result;
        }
        return null;
      } catch (err: unknown) {
        if (controller.signal.aborted) return null;

        let message = "Upload failed. Please try again.";
        if (err instanceof ApiError) {
          message = err.message;
        } else if (err instanceof Error && err.name !== "AbortError") {
          message = err.message;
        }

        setState("error");
        setError(message);
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState("idle");
    setError(null);
    setData(null);
  }, []);

  // cancel is an alias for reset — kept for semantic clarity at call-sites.
  const cancel = reset;

  return { state, error, data, upload, cancel, validate, reset };
}
