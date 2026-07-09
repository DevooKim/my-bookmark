import { savePushSubscription, unsubscribePush } from "./api-client";

export type PushSupportStatus =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "ios-not-installed" | "missing-key" };

export function getPushSupportStatus(
  vapidPublicKey: string | null,
): PushSupportStatus {
  if (!vapidPublicKey) {
    return { ok: false, reason: "missing-key" };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  if (isIosSafari() && !isStandalonePwa()) {
    return { ok: false, reason: "ios-not-installed" };
  }
  return { ok: true };
}

export async function enablePushNotifications(
  vapidPublicKey: string,
): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("notification-permission-denied");
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer,
    }));
  await savePushSubscription(toServerSubscription(subscription));
}

export async function disablePushNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  await unsubscribePush(subscription ? toServerSubscription(subscription) : {});
  await subscription?.unsubscribe();
}

export function urlBase64ToUint8Array(
  base64String: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }
  return output;
}

function toServerSubscription(subscription: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const json = subscription.toJSON();
  // biome-ignore lint/complexity/useLiteralKeys: PushSubscriptionJSON keys is an index signature under project TS config.
  const p256dh = json.keys?.["p256dh"];
  // biome-ignore lint/complexity/useLiteralKeys: PushSubscriptionJSON keys is an index signature under project TS config.
  const auth = json.keys?.["auth"];
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error("invalid-push-subscription");
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh, auth },
  };
}

function isIosSafari(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalonePwa(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean(navigator.standalone))
  );
}
