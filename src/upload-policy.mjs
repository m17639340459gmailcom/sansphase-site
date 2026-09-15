// Shared by the browser uploader and the Node server. GB/MB in the UI use
// binary units, consistent with the previous upload limits.
export const uploadLimits = Object.freeze({
  maxFileBytes:15*1024**3,
  maxImageBytes:25*1024**2,
  maxAudioBytes:100*1024**2,
});
export const uploadTimeoutMs=6*60*60*1000;
export function uploadSizeLabel(bytes) {
  return bytes>=1024**3 ? `${Math.round(bytes/1024**3)} GB` : `${Math.round(bytes/1024**2)} MB`;
}
