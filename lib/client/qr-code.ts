export interface QrCodeOptions {
  width: number;
  margin?: number;
}

type QrCodeModule = typeof import("qrcode");

let qrCodeModule: Promise<QrCodeModule> | null = null;

function loadQrCode() {
  qrCodeModule ??= import("qrcode");
  return qrCodeModule;
}

export async function generateQrCode(value: string, options: QrCodeOptions): Promise<string> {
  const module = await loadQrCode();
  return module.default.toDataURL(value, { margin: options.margin ?? 1, width: options.width });
}
