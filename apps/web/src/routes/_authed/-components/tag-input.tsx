import { useId, useState } from "react";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
}

const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 20;

export function TagInput({ value, onChange }: TagInputProps) {
  const inputId = useId();
  const messageId = useId();
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");
  const isFull = value.length >= MAX_TAGS;

  function addTag() {
    const tag = inputValue.trim();
    if (!tag || value.includes(tag)) {
      setInputValue("");
      setError("");
      return;
    }
    if (tag.length > MAX_TAG_LENGTH) {
      setError("태그는 20자 이하로 입력해 주세요.");
      return;
    }
    if (isFull) {
      return;
    }
    onChange([...value, tag]);
    setInputValue("");
    setError("");
  }

  const message = isFull
    ? "태그는 최대 5개까지 추가할 수 있어요."
    : error || "Enter 또는 쉼표로 태그를 추가하세요.";

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={inputId}>
        태그
      </label>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.map((tag) => (
            <span
              className="inline-flex min-h-11 items-center rounded-full bg-zinc-100 pl-3 text-sm dark:bg-zinc-800"
              key={tag}
            >
              {tag}
              <button
                aria-label={`${tag} 태그 삭제`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:text-zinc-100"
                onClick={() => onChange(value.filter((item) => item !== tag))}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        aria-describedby={messageId}
        className="input"
        disabled={isFull}
        id={inputId}
        maxLength={MAX_TAG_LENGTH + 1}
        onBlur={addTag}
        onChange={(event) => {
          setInputValue(event.target.value);
          setError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            addTag();
          }
        }}
        value={inputValue}
      />
      <p
        className={error ? "text-xs text-red-600" : "text-xs text-zinc-500"}
        id={messageId}
        role="status"
      >
        {message}
      </p>
    </div>
  );
}
