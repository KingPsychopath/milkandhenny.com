declare module "qrcode/lib/browser" {
  export function toDataURL(
    text: string,
    options?: { margin?: number; width?: number }
  ): Promise<string>;
}
