interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** Ключ API в свёрнутом блоке: нужен для файлов и MCP-агентов. */
export function TokenField({ value, onChange }: Props) {
  return (
    <details className="auto-token">
      <summary>Ключ API</summary>
      <div className="auto-token-box">
        <input
          type="password"
          value={value}
          placeholder="Ключ API"
          autoComplete="off"
          aria-label="Ключ API"
          onChange={e => onChange(e.target.value)}
        />
        <small>Файл data/api_token.txt · нужен для файлов и для агентов</small>
      </div>
    </details>
  );
}
