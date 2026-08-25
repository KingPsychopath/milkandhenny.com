import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  type OnProgressParameters,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useSwipe } from "@/hooks/useSwipe";
import {
  nextZoom,
  TransferPdfToolbar,
  type Zoom,
} from "@/features/transfers/ui/transfer/TransferPdfToolbar";

type TransferPdfReaderProps = {
  filename: string;
  sourceUrl: string;
  downloadUrl: string;
  onClose: () => void;
};

const MAX_RENDER_PIXELS = 24_000_000;

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function TransferPdfReader({ filename, sourceUrl, downloadUrl, onClose }: TransferPdfReaderProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [rotation, setRotation] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const passwordCallbackRef = useRef<((password: string) => void) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const changePage = useCallback(
    (nextPage: number) => {
      if (!pdf) return;
      const clamped = Math.min(pdf.numPages, Math.max(1, nextPage));
      setPage(clamped);
      setPageInput(String(clamped));
      viewportRef.current?.scrollTo({ top: 0, left: 0 });
    },
    [pdf],
  );

  const swipeRef = useSwipe<HTMLDivElement>({
    onSwipeLeft: () => changePage(page + 1),
    onSwipeRight: () => changePage(page - 1),
    enabled: Boolean(pdf) && !needsPassword,
  });

  const setViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      swipeRef.current = node;
    },
    [swipeRef],
  );

  useEffect(() => {
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadPdf() {
      try {
        if (disposed) return;
        GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        loadingTask = getDocument({ url: sourceUrl });
        loadingTask.onProgress = ({ loaded, total }: OnProgressParameters) => {
          if (!disposed && total > 0) setLoadingProgress(Math.round((loaded / total) * 100));
        };
        loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
          if (disposed) return;
          passwordCallbackRef.current = updatePassword;
          setPassword("");
          setPasswordError(
            reason === PasswordResponses.INCORRECT_PASSWORD
              ? "That password did not open this PDF."
              : "This PDF is password protected.",
          );
          setNeedsPassword(true);
        };
        const document = await loadingTask.promise;
        if (disposed) return;
        setPdf(document);
        setLoadingProgress(null);
        setNeedsPassword(false);
        setPasswordError("");
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : "This PDF could not be opened.");
      }
    }

    void loadPdf();
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      void loadingTask?.destroy();
    };
  }, [sourceUrl]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => setViewportWidth(viewport.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvasRef.current || viewportWidth <= 0) return;
    const document = pdf;
    let disposed = false;
    let pdfPage: PDFPageProxy | null = null;
    renderTaskRef.current?.cancel();

    async function renderPage() {
      setRendering(true);
      setError("");
      try {
        pdfPage = await document.getPage(page);
        if (disposed || !canvasRef.current) return;
        const natural = pdfPage.getViewport({ scale: 1, rotation });
        const cssScale =
          zoom === "fit" ? Math.min(3, Math.max(0.1, (viewportWidth - 32) / natural.width)) : zoom;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const requestedPixels = natural.width * natural.height * cssScale ** 2 * pixelRatio ** 2;
        const renderRatio =
          requestedPixels > MAX_RENDER_PIXELS
            ? pixelRatio * Math.sqrt(MAX_RENDER_PIXELS / requestedPixels)
            : pixelRatio;
        const renderViewport = pdfPage.getViewport({
          scale: cssScale * renderRatio,
          rotation,
        });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("This browser could not create a PDF canvas.");
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${Math.round(natural.width * cssScale)}px`;
        canvas.style.height = `${Math.round(natural.height * cssScale)}px`;
        const task = pdfPage.render({ canvas, canvasContext: context, viewport: renderViewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (cause) {
        if (
          !disposed &&
          (!(cause instanceof Error) || cause.name !== "RenderingCancelledException")
        ) {
          setError(cause instanceof Error ? cause.message : "This page could not be rendered.");
        }
      } finally {
        if (!disposed) {
          setRendering(false);
          pdfPage?.cleanup();
        }
      }
    }

    void renderPage();
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
    };
  }, [page, pdf, rotation, viewportWidth, zoom]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (isEditableTarget(event.target) || !pdf || needsPassword) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") changePage(page - 1);
      if (event.key === "ArrowRight" || event.key === "PageDown") changePage(page + 1);
      if (event.key === "Home") changePage(1);
      if (event.key === "End") changePage(pdf.numPages);
      if (event.key === "+" || event.key === "=") setZoom((current) => nextZoom(current, 1));
      if (event.key === "-") setZoom((current) => nextZoom(current, -1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [changePage, needsPassword, onClose, page, pdf]);

  const handlePageSubmit = (event: FormEvent) => {
    event.preventDefault();
    const requested = Number.parseInt(pageInput, 10);
    if (Number.isFinite(requested)) changePage(requested);
    else setPageInput(String(page));
  };

  const handlePasswordSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!password || !passwordCallbackRef.current) return;
    setNeedsPassword(false);
    setPasswordError("");
    passwordCallbackRef.current(password);
  };

  return (
    // react-doctor-disable-next-line prefer-html-dialog -- focus trapping and keyboard handling provide modal behavior
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-pdf-title"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <TransferPdfToolbar
        filename={filename}
        downloadUrl={downloadUrl}
        page={page}
        totalPages={pdf?.numPages ?? null}
        pageInput={pageInput}
        zoom={zoom}
        onPageInputChange={setPageInput}
        onPageSubmit={handlePageSubmit}
        onPageChange={changePage}
        onZoomChange={setZoom}
        onRotate={() => setRotation((value) => (value + 90) % 360)}
        onClose={onClose}
      />

      <div
        ref={setViewportRef}
        className="relative flex flex-1 items-start justify-center overflow-auto bg-stone-200 p-4 dark:bg-stone-950"
        aria-busy={rendering || !pdf}
      >
        {!pdf && !error && !needsPassword ? (
          <div className="m-auto text-center font-mono text-micro theme-muted" role="status">
            opening PDF{loadingProgress === null ? "..." : ` · ${loadingProgress}%`}
          </div>
        ) : null}

        {needsPassword ? (
          <form
            onSubmit={handlePasswordSubmit}
            className="m-auto w-full max-w-sm rounded-sm border theme-border bg-background p-6"
          >
            <h2 className="font-serif text-xl text-foreground">Protected PDF</h2>
            <p className="mt-2 font-mono text-micro theme-muted">{passwordError}</p>
            <label htmlFor="pdf-password" className="mt-5 block font-mono text-micro">
              password
            </label>
            <input
              id="pdf-password"
              type="password"
              autoComplete="off"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-sm border theme-border bg-transparent px-3 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={!password}
              className="mt-4 min-h-11 font-mono text-micro text-amber-600 transition-opacity hover:opacity-60 disabled:opacity-30"
            >
              [ open PDF ]
            </button>
          </form>
        ) : null}

        {error ? (
          <div className="m-auto max-w-md text-center">
            <p className="font-serif text-xl text-foreground">This PDF could not be displayed.</p>
            <p className="mt-3 font-mono text-micro theme-muted">{error}</p>
            <a
              href={downloadUrl}
              className="mt-5 inline-flex min-h-11 items-center font-mono text-micro text-amber-600 transition-opacity hover:opacity-60"
            >
              [ download the original ]
            </a>
          </div>
        ) : null}

        {pdf && !needsPassword && !error ? (
          <canvas
            ref={canvasRef}
            aria-label={`${filename}, page ${page} of ${pdf.numPages}`}
            className={rendering ? "bg-white opacity-70 shadow-2xl" : "bg-white shadow-2xl"}
          />
        ) : null}
      </div>
    </div>
  );
}

export { TransferPdfReader };
