// Request Queue - Limits concurrent image fetches to prevent server overload
// and improves perceived loading speed

import { api } from './api';

type QueuedRequest<T> = {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  priority: number;
};

class RequestQueue {
  private queue: QueuedRequest<any>[] = [];
  private running = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent = 6) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Add a request to the queue
   * @param execute Function that returns a promise
   * @param priority Higher priority items are processed first (default: 0)
   */
  async add<T>(execute: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      // Insertion-sort by priority (higher first) — O(n) vs O(n log n) for sort
      const item = { execute, resolve, reject, priority };
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1].priority < priority) i--;
      this.queue.splice(i, 0, item);
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.running++;

    try {
      const result = await item.execute();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.running--;
      this.process();
    }
  }

  /**
   * Clear all pending requests
   */
  clear(): void {
    this.queue.forEach((item) => {
      item.reject(new Error('Queue cleared'));
    });
    this.queue = [];
  }

  /**
   * Get the number of pending requests
   */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Get the number of currently running requests
   */
  get active(): number {
    return this.running;
  }
}

// Singleton instance for image loading (6 concurrent for better throughput)
export const imageQueue = new RequestQueue(6);

// Deduplication cache for in-flight requests
const inFlightRequests = new Map<string, Promise<string>>();

// Reference counting for blob URLs - prevents premature revocation when multiple components use same URL
const blobUrlRefCount = new Map<string, { blobUrl: string; count: number }>();

// Detect MIME type from base64 data magic bytes
function detectMimeType(base64: string): string {
  // Check first few chars of base64 for known magic bytes
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('R0lGO')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg'; // fallback
}

/**
 * Internal helper: fetch image data via API with 1 automatic retry
 */
async function fetchWithRetry(
  apiObj: { request: (config: any) => Promise<any> },
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  const doFetch = async () => {
    const res = await apiObj.request({
      method: 'GET',
      url,
      headers,
      responseType: 'arraybuffer',
    });

    if (!res.success || !res.data) {
      throw new Error(res.error || `Failed to fetch image: ${url}`);
    }

    return res.data as string;
  };

  try {
    return await doFetch();
  } catch (firstError) {
    // 1 automatic retry after a short delay
    console.warn(`[ImageQueue] Fetch failed, retrying: ${url}`, (firstError as Error).message);
    await new Promise(r => setTimeout(r, 500));
    try {
      return await doFetch();
    } catch (retryError) {
      console.warn(`[ImageQueue] Retry also failed: ${url}`, (retryError as Error).message);
      throw retryError;
    }
  }
}

/**
 * Convert base64 response data to a blob URL with proper MIME type
 */
function base64ToBlobUrl(data: string): string {
  const mimeType = detectMimeType(data);
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Fetch an image with deduplication and queueing
 * Returns a blob URL - use releaseImage() when done to properly manage memory
 */
export async function fetchImage(
  url: string,
  headers?: Record<string, string>,
  priority = 0
): Promise<string> {
  // Check if we already have a blob URL for this source URL
  const existingRef = blobUrlRefCount.get(url);
  if (existingRef) {
    existingRef.count++;
    return existingRef.blobUrl;
  }

  // Check for existing in-flight request
  const existing = inFlightRequests.get(url);
  if (existing) {
    const blobUrl = await existing;
    const ref = blobUrlRefCount.get(url);
    if (ref) {
      ref.count++;
    }
    return blobUrl;
  }

  const requestPromise = imageQueue.add(async () => {
    try {
      const data = await fetchWithRetry(api, url, headers);
      const blobUrl = base64ToBlobUrl(data);
      blobUrlRefCount.set(url, { blobUrl, count: 1 });
      return blobUrl;
    } finally {
      inFlightRequests.delete(url);
    }
  }, priority);

  inFlightRequests.set(url, requestPromise);
  return requestPromise;
}

/**
 * Release a blob URL - decrements reference count and revokes when no longer needed
 * Call this in component cleanup instead of directly calling URL.revokeObjectURL()
 * @param sourceUrl The original source URL (not the blob URL)
 */
export function releaseImage(sourceUrl: string): void {
  const ref = blobUrlRefCount.get(sourceUrl);
  if (!ref) return;

  ref.count--;

  if (ref.count <= 0) {
    URL.revokeObjectURL(ref.blobUrl);
    blobUrlRefCount.delete(sourceUrl);
  }
}

/**
 * Get the current reference count for a URL (for debugging)
 */
export function getImageRefCount(sourceUrl: string): number {
  return blobUrlRefCount.get(sourceUrl)?.count || 0;
}

/**
 * Fetch an image through the backend API (for authenticated requests)
 * This bypasses CORS and handles auth headers properly.
 * Includes automatic retry on failure and proper MIME type detection.
 * Returns a blob URL - use releaseImage() when done to properly manage memory
 */
export async function fetchImageViaApi(
  url: string,
  api: { request: (config: any) => Promise<any> },
  headers?: Record<string, string>,
  priority = 0
): Promise<string> {
  // Check if we already have a blob URL for this source URL
  const existingRef = blobUrlRefCount.get(url);
  if (existingRef) {
    existingRef.count++;
    return existingRef.blobUrl;
  }

  // Check for existing in-flight request
  const existing = inFlightRequests.get(url);
  if (existing) {
    const blobUrl = await existing;
    const ref = blobUrlRefCount.get(url);
    if (ref) {
      ref.count++;
    }
    return blobUrl;
  }

  const requestPromise = imageQueue.add(async () => {
    try {
      const data = await fetchWithRetry(api, url, headers);
      const blobUrl = base64ToBlobUrl(data);
      blobUrlRefCount.set(url, { blobUrl, count: 1 });
      return blobUrl;
    } finally {
      inFlightRequests.delete(url);
    }
  }, priority);

  inFlightRequests.set(url, requestPromise);
  return requestPromise;
}

export default RequestQueue;
