import type { SourceOption } from '@/lib/sources';

interface Props {
  id?: string;
  value: string;
  options: SourceOption[];
  placeholder: string;
  onChange: (value: string) => void;
  'aria-label'?: string;
  className?: string;
}

/** Выбор сценария или макроса (см. lib/sources). */
export function SourceSelect({ id, value, options, placeholder, onChange, className, ...rest }: Props) {
  return (
    <select
      id={id}
      className={className}
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={rest['aria-label']}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
