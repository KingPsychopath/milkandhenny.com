import { useEffect, useState } from "react";
import { generateQrCode } from "@/lib/client/qr-code";

export function useQrCode(value: string | null, width: number) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setDataUrl(null);
    if (!value) {
      return;
    }
    void generateQrCode(value, { width })
      .then((nextDataUrl) => {
        if (active) setDataUrl(nextDataUrl);
      })
      .catch(() => {
        if (active) {
          setDataUrl(null);
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [value, width]);

  return { dataUrl, failed };
}
