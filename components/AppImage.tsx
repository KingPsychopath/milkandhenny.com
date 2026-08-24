import { forwardRef, type ForwardedRef, type ImgHTMLAttributes } from "react";
import type { ResponsiveImageSource } from "@/features/media/image";

type NativeImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "decoding" | "fetchPriority" | "loading" | "src" | "srcSet"
>;

interface AppImageProps extends NativeImageProps {
  alt: string;
  src: string;
  srcSet?: string;
  sources?: ResponsiveImageSource[];
  priority?: boolean;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
  fetchPriority?: "high" | "low" | "auto";
  /** Fade editorial media from its reserved placeholder after decode. */
  reveal?: boolean;
}

function setForwardedRef(ref: ForwardedRef<HTMLImageElement>, node: HTMLImageElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

function revealImage(node: HTMLImageElement) {
  void node
    .decode()
    .catch(() => undefined)
    .then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (node.isConnected) delete node.dataset.revealPending;
        });
      });
    });
}

const AppImage = forwardRef<HTMLImageElement, AppImageProps>(function AppImage(
  {
    alt,
    decoding = "async",
    fetchPriority,
    loading,
    priority = false,
    reveal = false,
    sizes,
    sources,
    src,
    srcSet,
    className,
    onLoad,
    ...props
  },
  ref,
) {
  const imageRef = (node: HTMLImageElement | null) => {
    setForwardedRef(ref, node);
    if (reveal && node && !node.complete) node.dataset.revealPending = "true";
  };

  const image = (
    <img
      {...props}
      ref={imageRef}
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      loading={priority ? "eager" : (loading ?? "lazy")}
      decoding={decoding}
      fetchPriority={priority ? "high" : fetchPriority}
      className={[className, reveal ? "app-image-reveal" : undefined].filter(Boolean).join(" ")}
      onLoad={(event) => {
        if (reveal && event.currentTarget.dataset.revealPending) {
          revealImage(event.currentTarget);
        }
        onLoad?.(event);
      }}
    />
  );

  if (!sources?.length) return image;

  return (
    <picture>
      {sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={sizes} />
      ))}
      {image}
    </picture>
  );
});

export { AppImage };
export type { AppImageProps };
