import { forwardRef, type ImgHTMLAttributes } from "react";
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
}

const AppImage = forwardRef<HTMLImageElement, AppImageProps>(function AppImage(
  {
    alt,
    decoding = "async",
    fetchPriority,
    loading,
    priority = false,
    sizes,
    sources,
    src,
    srcSet,
    ...props
  },
  ref,
) {
  const image = (
    <img
      {...props}
      ref={ref}
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      loading={priority ? "eager" : (loading ?? "lazy")}
      decoding={decoding}
      fetchPriority={priority ? "high" : fetchPriority}
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
