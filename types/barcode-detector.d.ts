interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface Window {
  BarcodeDetector?: {
    new (options?: BarcodeDetectorOptions): {
      detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
    };
  };
}
