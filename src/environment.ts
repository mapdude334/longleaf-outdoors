/** Preview builds share a Pages host with production, so isolate browser data. */
export const IS_PREVIEW = import.meta.env.VITE_PREVIEW === 'true';
export const storageKey = (key: string) => IS_PREVIEW ? `longleaf-preview:${key}` : key;
export const cacheName = (name: string) => IS_PREVIEW ? `longleaf-preview-${name}` : name;
