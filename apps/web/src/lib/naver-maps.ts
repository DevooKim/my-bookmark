import type {
  MapAdapter,
  MapAdapterFactory,
  MapMarkerView,
  MapPoint,
} from "./map-adapter";

// 네이버 지도 JavaScript API v3. 스크립트 URL과 인증 파라미터(ncpKeyId)는 공식 문서
// (https://navermaps.github.io/maps.js.ncp/)의 현행 형식이다. 과거 이름은 ncpClientId.
const SDK_URL = "https://oapi.map.naver.com/openapi/v3/maps.js";
const MARKER_SIZE = 28;
const FIT_PADDING = 56;
const SINGLE_POINT_ZOOM = 16;

declare global {
  interface Window {
    // SDK가 인증 실패 시 호출하는 전역 콜백
    navermap_authFailure?: (() => void) | undefined;
  }
}

let sdkPromise: Promise<void> | null = null;

export function loadNaverMapsSdk(clientId: string): Promise<void> {
  if (typeof naver !== "undefined" && naver.maps) {
    return Promise.resolve();
  }
  if (!sdkPromise) {
    sdkPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${SDK_URL}?ncpKeyId=${encodeURIComponent(clientId)}`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        sdkPromise = null;
        reject(new Error("네이버 지도 SDK를 불러오지 못했습니다"));
      };
      document.head.append(script);
    });
  }
  return sdkPromise;
}

function markerContent(view: MapMarkerView): HTMLElement {
  const element = document.createElement("div");
  element.textContent = view.label;
  const active = view.state === "active";
  element.style.cssText = [
    `width:${MARKER_SIZE}px`,
    `height:${MARKER_SIZE}px`,
    "border-radius:9999px",
    `background:${view.color}`,
    "color:#fff",
    "font:700 12px/1 system-ui,sans-serif",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    `border:${active ? 3 : 2}px solid #fff`,
    `box-shadow:0 1px 4px rgb(0 0 0/${active ? 0.55 : 0.35})`,
    `opacity:${view.state === "dim" ? 0.35 : 1}`,
    `transform:scale(${active ? 1.25 : 1})`,
    "cursor:pointer",
  ].join(";");
  return element;
}

function zIndexFor(view: MapMarkerView): number {
  if (view.state === "active") {
    return 1000;
  }
  return view.state === "dim" ? 1 : 10;
}

export function createNaverMapAdapterFactory(
  clientId: string,
): MapAdapterFactory {
  return async (container, handlers) => {
    window.navermap_authFailure = () => handlers.onAuthFailure();
    await loadNaverMapsSdk(clientId);

    const map = new naver.maps.Map(container, {
      center: new naver.maps.LatLng(37.5665, 126.978),
      zoom: 11,
      zoomControl: true,
      zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT },
    });
    const markers = new Map<string, naver.maps.Marker>();
    const signatures = new Map<string, string>();
    const listeners: naver.maps.MapEventListener[] = [
      naver.maps.Event.addListener(map, "click", () =>
        handlers.onBackgroundClick(),
      ),
    ];

    const adapter: MapAdapter = {
      setMarkers(views) {
        const nextIds = new Set(views.map((view) => view.id));
        for (const [id, marker] of markers) {
          if (!nextIds.has(id)) {
            marker.setMap(null);
            markers.delete(id);
            signatures.delete(id);
          }
        }
        for (const view of views) {
          const signature = `${view.color}|${view.label}|${view.state}|${view.lat}|${view.lng}`;
          const icon = {
            content: markerContent(view),
            anchor: new naver.maps.Point(MARKER_SIZE / 2, MARKER_SIZE / 2),
          };
          const existing = markers.get(view.id);
          if (!existing) {
            const marker = new naver.maps.Marker({
              map,
              position: new naver.maps.LatLng(view.lat, view.lng),
              icon,
              zIndex: zIndexFor(view),
            });
            listeners.push(
              naver.maps.Event.addListener(marker, "click", () =>
                handlers.onMarkerClick(view.id),
              ),
            );
            markers.set(view.id, marker);
          } else if (signatures.get(view.id) !== signature) {
            existing.setIcon(icon);
            existing.setPosition(new naver.maps.LatLng(view.lat, view.lng));
            existing.setZIndex(zIndexFor(view));
          }
          signatures.set(view.id, signature);
        }
      },
      fitTo(points: readonly MapPoint[]) {
        const first = points[0];
        if (!first) {
          return;
        }
        let south = first.lat;
        let north = first.lat;
        let west = first.lng;
        let east = first.lng;
        for (const point of points) {
          south = Math.min(south, point.lat);
          north = Math.max(north, point.lat);
          west = Math.min(west, point.lng);
          east = Math.max(east, point.lng);
        }
        if (south === north && west === east) {
          map.setCenter(new naver.maps.LatLng(south, west));
          map.setZoom(SINGLE_POINT_ZOOM);
          return;
        }
        map.fitBounds(
          new naver.maps.LatLngBounds(
            new naver.maps.LatLng(south, west),
            new naver.maps.LatLng(north, east),
          ),
          {
            top: FIT_PADDING,
            right: FIT_PADDING,
            bottom: FIT_PADDING,
            left: FIT_PADDING,
            maxZoom: 17,
          },
        );
      },
      panTo(point) {
        map.panTo(new naver.maps.LatLng(point.lat, point.lng));
      },
      destroy() {
        naver.maps.Event.removeListener(listeners);
        for (const marker of markers.values()) {
          marker.setMap(null);
        }
        markers.clear();
        signatures.clear();
        map.destroy();
        window.navermap_authFailure = undefined;
      },
    };
    return adapter;
  };
}
