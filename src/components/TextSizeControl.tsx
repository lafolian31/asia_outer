import { useLayoutEffect, useState } from "react";
const sizes = [
  { value: "small", label: "조금 작게" },
  { value: "normal", label: "기본" },
  { value: "large", label: "크게" },
  { value: "extra", label: "아주 크게" },
];
export function TextSizeControl({ userId }: { userId?: string }) {
  const [size, setSize] = useState(
    document.documentElement.dataset.textSize || "normal",
  );
  useLayoutEffect(() => {
    try {
      const saved =
        (userId && localStorage.getItem(`farm-text-size:${userId}`)) ||
        localStorage.getItem("farm-text-size");
      if (sizes.some((option) => option.value === saved)) {
        document.documentElement.dataset.textSize = saved!;
        setSize(saved!);
      }
    } catch {
      /* Keep the current size if browser storage is unavailable. */
    }
  }, [userId]);
  return (
    <details className="text-size-control">
      <summary>
        가 <span>글자 크기</span>
      </summary>
      <div className="text-size-panel">
        <strong>편안한 글자 크기를 선택하세요</strong>
        <div role="group" aria-label="글자 크기 선택">
          {sizes.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={size === option.value}
              onClick={() => {
                document.documentElement.dataset.textSize = option.value;
                setSize(option.value);
                try {
                  localStorage.setItem("farm-text-size", option.value);
                  if (userId)
                    localStorage.setItem(
                      `farm-text-size:${userId}`,
                      option.value,
                    );
                } catch {
                  /* Readability must not depend on local storage. */
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p>
          마지막 선택을 이 브라우저에 저장합니다. 로그인한 계정별로 기억해 다음
          접속에도 적용해요.
        </p>
      </div>
    </details>
  );
}
