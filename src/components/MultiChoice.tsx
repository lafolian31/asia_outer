export function MultiChoice({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
}) {
  const labels = values.map(
    (v) => options.find((o) => o.value === v)?.label || v,
  );
  return (
    <details className="multi-choice">
      <summary>
        {label}{" "}
        <small>{labels.length ? labels.join(", ") : "선택 안 함"}</small>
        <span className="muted">여러 개 선택 가능</span>
      </summary>
      <fieldset aria-label={label}>
        {options.map((o) => (
          <label key={o.value}>
            <input
              type="checkbox"
              value={o.value}
              checked={values.includes(o.value)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...values, o.value]
                    : values.filter((v) => v !== o.value),
                )
              }
            />
            {o.label}
          </label>
        ))}
        {!options.length && <p className="muted">등록된 항목이 없습니다.</p>}
        {!!values.length && (
          <button
            type="button"
            className="text-button"
            onClick={() => onChange([])}
          >
            선택 해제
          </button>
        )}
      </fieldset>
    </details>
  );
}
