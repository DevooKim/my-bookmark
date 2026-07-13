const DATABASE_NAME = "my-bookmark-share-target";
const STORE_NAME = "batches";
const DATABASE_VERSION = 1;

export interface ShareTargetRecord {
  id: string;
  createdAt: number;
  images: Array<{
    blob: Blob;
    name: string;
    type: string;
    lastModified: number;
  }>;
}

export interface ShareTargetStore {
  put(record: ShareTargetRecord): Promise<void>;
  get(id: string): Promise<ShareTargetRecord | undefined>;
  delete(id: string): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () =>
        reject(request.error ?? new Error("공유 이미지를 저장하지 못했어요")),
      { once: true },
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("공유 저장소를 열지 못했어요")),
      { once: true },
    );
  });
}

const indexedDbStore: ShareTargetStore = {
  async put(record) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      await requestResult(transaction.objectStore(STORE_NAME).put(record));
    } finally {
      database.close();
    }
  },
  async get(id) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      return await requestResult<ShareTargetRecord | undefined>(
        transaction.objectStore(STORE_NAME).get(id),
      );
    } finally {
      database.close();
    }
  },
  async delete(id) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      await requestResult(transaction.objectStore(STORE_NAME).delete(id));
    } finally {
      database.close();
    }
  },
};

export async function stageSharedImages(
  files: File[],
  store: ShareTargetStore = indexedDbStore,
): Promise<string> {
  const images = files
    .filter((file) => file.type.startsWith("image/"))
    .map((file) => ({
      blob: file.slice(0, file.size, file.type),
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
    }));
  if (images.length === 0) {
    throw new Error("공유된 이미지가 없습니다");
  }

  const id = crypto.randomUUID();
  await store.put({ id, createdAt: Date.now(), images });
  return id;
}

export async function loadSharedImages(
  id: string,
  store: ShareTargetStore = indexedDbStore,
): Promise<File[] | null> {
  const record = await store.get(id);
  if (!record) {
    return null;
  }
  return record.images.map(
    (image) =>
      new File([image.blob], image.name, {
        type: image.type,
        lastModified: image.lastModified,
      }),
  );
}

export async function deleteSharedImages(
  id: string,
  store: ShareTargetStore = indexedDbStore,
): Promise<void> {
  await store.delete(id);
}
