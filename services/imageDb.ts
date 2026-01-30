/**
 * IndexedDB service for storing and retrieving image data
 * Keeps images separate from canvas data to avoid bloating the save files
 */

const DB_NAME = 'BlockCanvasDB';
const STORE_NAME = 'images';
const DB_VERSION = 1;

interface StoredImage {
  id: string;
  data: Blob;
  mimeType: string;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// In-memory cache for recently saved blobs to avoid IndexedDB read-after-write races
const memoryCache: Record<string, Blob> = {};
const getDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });

  return dbPromise;
};

export const saveImage = async (imageId: string, base64String: string, mimeType: string): Promise<void> => {
  try {
    const db = await getDB();
    const binary = atob(base64String.split(',')[1] || base64String);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });

    // Cache the blob in-memory so it can be used immediately after saving
    try {
      memoryCache[imageId] = blob;
    } catch (err) {
      // Ignore caching errors
    }

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        id: imageId,
        data: blob,
        mimeType,
        timestamp: Date.now()
      });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Failed to save image to IndexedDB:', error);
    throw error;
  }
};

export const getImageBlob = async (imageId: string): Promise<Blob | null> => {
  // Check memory cache first to avoid read-after-write delay
  if (memoryCache[imageId]) {
    return memoryCache[imageId];
  }

  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(imageId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (!request.result) {
          resolve(null);
          return;
        }

        const { data, mimeType } = request.result;
        resolve(new Blob([data], { type: mimeType }));
      };
    });
  } catch (error) {
    console.error('Failed to retrieve image blob from IndexedDB:', error);
    return null;
  }
};

export const getImage = async (imageId: string): Promise<string | null> => {
  const blob = await getImageBlob(imageId);
  if (!blob) return null;
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

export const deleteImage = async (imageId: string): Promise<void> => {
  try {
    // Remove from memory cache if present
    if (memoryCache[imageId]) delete memoryCache[imageId];
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(imageId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Failed to delete image from IndexedDB:', error);
  }
};

export const deleteMultipleImages = async (imageIds: string[]): Promise<void> => {
  try {
    // Remove from memory cache
    for (const id of imageIds) {
      if (memoryCache[id]) delete memoryCache[id];
    }
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await Promise.all(
      imageIds.map(
        id =>
          new Promise<void>((resolve, reject) => {
            const request = store.delete(id);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
          })
      )
    );
  } catch (error) {
    console.error('Failed to delete multiple images from IndexedDB:', error);
  }
};

export const clearAllImages = async (): Promise<void> => {
  try {
    // Clear memory cache
    for (const k of Object.keys(memoryCache)) delete memoryCache[k];
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Failed to clear all images from IndexedDB:', error);
  }
};
