/**
 * When true, Meta AI and Ollama UI actions show a placeholder alert instead of running.
 * Set to false to restore full behavior (opening Meta / calling Ollama APIs).
 */
export const META_AND_OLLAMA_UI_PLACEHOLDER_ACTIVE = true;

export const META_OLLAMA_PLACEHOLDER_MESSAGE =
  "This is a placeholder for when Meta actually gets its act together!";

export function showMetaOllamaPlaceholder(): void {
  if (typeof window !== "undefined") {
    window.alert(META_OLLAMA_PLACEHOLDER_MESSAGE);
  }
}
