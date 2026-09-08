// This first production release predates signatures in saved geometry. Its
// atlas.json and every raw geometry chunk were verified byte-identical to the
// first signed release. Never infer compatibility from a newer commit alone.
const legacySignatures: Record<string, string> = {
  "5968f08031e185df3830637e961a2d0f3d47caad":
    "da72bf9b512622cab3f69d1e1eef131c9ec279bd6b0f2973f375ec285b69792a",
};
type Version = { engine?: string; geometrySignature?: string };
type Release = { commit: string; geometrySignature?: string };
export function signatureFor(source: Version, release: Release) {
  return (
    source.geometrySignature ||
    (source.engine && source.engine !== release.commit
      ? legacySignatures[source.engine]
      : release.geometrySignature)
  );
}
export function anatomyCompatible(source: Version, release: Release) {
  if (!source.engine && !source.geometrySignature) return false;
  const signature = signatureFor(source, release);
  return signature
    ? signature === release.geometrySignature
    : source.engine === release.commit;
}
