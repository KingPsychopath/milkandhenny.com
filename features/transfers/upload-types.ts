import type { TransferFile } from "./store";

type ConvertedFrom = "heic";

type TransferUploadFileInput = {
  /** Filename stored in transfer metadata and shown in the gallery. */
  name: string;
  /** Size in bytes of the primary uploaded object. */
  size: number;
  type?: string;
  /** Original HEIF filename archived separately when browser conversion runs. */
  originalName?: string;
  originalSize?: number;
  originalType?: string;
  convertedFrom?: ConvertedFrom;
};

type ProcessFileResult = {
  /** Metadata for this file (goes into the transfer manifest). */
  file: TransferFile;
  /** Total bytes uploaded to R2 (all variants combined). */
  uploadedBytes: number;
};

export type { ConvertedFrom, ProcessFileResult, TransferUploadFileInput };
