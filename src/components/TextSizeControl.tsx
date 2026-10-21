import { useState } from "react";
const sizes = [
  { value: "normal", label: "기본" },
  { value: "large", label: "크게" },
  { value: "extra", label: "아주 크게" },
];
export function TextSizeControl() {
  const [size, setSize] = useState(
    document.documentElement.dataset.textSize || "normal",
  );
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
          이 기기에서 다음 접속에도 유지됩니다. 화면을 넓게 보려면 기본으로
          되돌릴 수 있어요.
        </p>
      </div>
    </details>
  );
}
