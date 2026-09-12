export const EVIDENCE_BUCKET = "evidence-photos";

/** Supabase Storageのキーとして安全な拡張子のみを抽出する(日本語ファイル名等をキーに含めない)。 */
function safeExtension(fileName: string) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : "jpg";
}

export function arrivalPhotoPath(
  eventId: string,
  teamId: string,
  idempotencyKey: string,
  index: number,
  fileName: string
) {
  return `${eventId}/${teamId}/arrival/${idempotencyKey}/${index}.${safeExtension(fileName)}`;
}

export function startCheckinPhotoPath(
  eventId: string,
  teamId: string,
  idempotencyKey: string,
  index: number,
  fileName: string
) {
  return `${eventId}/${teamId}/start_checkin/${idempotencyKey}/${index}.${safeExtension(fileName)}`;
}

export function missionPhotoPath(
  eventId: string,
  teamId: string,
  attemptId: string,
  index: number,
  fileName: string
) {
  return `${eventId}/${teamId}/mission/${attemptId}/${index}.${safeExtension(fileName)}`;
}
