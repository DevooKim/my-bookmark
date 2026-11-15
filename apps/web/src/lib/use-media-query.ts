import { useEffect, useState } from "react";

// matchMedia가 없는 환경(테스트, 아주 오래된 브라우저)에서는 일치하지 않는 것으로 본다.
function matches(query: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}

export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const list = window.matchMedia(query);
    const update = () => setValue(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return value;
}

// Tailwind의 sm(40rem) 미만. Tailwind와 같은 rem 단위라 브라우저 글꼴 크기를 바꿔도 CSS와 어긋나지 않는다. 지도 화면이 하단 시트 레이아웃으로 바뀌는 지점이다.
export const MOBILE_MAP_QUERY = "(width < 40rem)";
