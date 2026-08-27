import { uploadPresignedObject } from "@/lib/client/presigned-upload";

type UploadTarget = {
  primaryUrl: string;
  contentType: string;
};

type StaffPhotoUploadOptions = {
  file: File;
  uploadPath: string;
  albumPath?: string;
  request?: typeof fetch;
  createId?: () => string;
};

function dropToken(uploadPath: string) {
  return uploadPath.split("/drop/")[1]?.split(/[?#]/)[0];
}

export async function uploadStaffScorePhoto({
  file,
  uploadPath,
  albumPath = "event-album",
  request,
  createId = () => crypto.randomUUID(),
}: StaffPhotoUploadOptions) {
  const apiRequest = request ?? fetch;
  const token = dropToken(uploadPath);
  if (!token) throw new Error("The event photo album is not open for uploads.");

  const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".jpg";
  const name = `score-${createId()}${extension}`;
  const payload = { name, size: file.size, type: file.type || "image/jpeg" };
  const presign = await apiRequest("/api/drop/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, files: [payload] }),
  });
  const prepared = (await presign.json().catch(() => ({}))) as {
    urls?: UploadTarget[];
    error?: string;
  };
  const target = prepared.urls?.[0];
  if (!presign.ok || !target) throw new Error(prepared.error ?? "Could not start the upload");

  const uploaded = await uploadPresignedObject(
    { url: target.primaryUrl, body: file, contentType: target.contentType },
    request ? { request } : undefined,
  );
  if (!uploaded.ok) throw new Error("The photograph did not upload");

  const finalized = await apiRequest("/api/drop/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, files: [payload] }),
  });
  if (!finalized.ok) throw new Error("The photograph uploaded but could not be attached");

  return `${albumPath}#${encodeURIComponent(name)}`;
}
