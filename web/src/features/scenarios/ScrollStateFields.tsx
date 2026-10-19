import type { ScrollState } from '@/lib/types';

interface Props {
  state: ScrollState;
  onChange: (state: ScrollState) => void;
}

/** Прокрутка страницы и вложенных областей, записанная вместе с кликом по точке. */
export function ScrollStateFields({ state, onChange }: Props) {
  const changeTarget = (index: number, top: number) =>
    onChange({ ...state, targets: state.targets.map((t, i) => (i === index ? { ...t, top } : t)) });

  return (
    <>
      <div>
        <label>Прокрутка страницы, px</label>
        <input
          type="number"
          min={0}
          value={state.y}
          onChange={e => onChange({ ...state, y: Number(e.target.value) })}
        />
      </div>
      {state.targets.map((target, i) => (
        <div key={i}>
          <label>Прокрутка области {i + 1}, px</label>
          <input
            type="number"
            min={0}
            value={target.top}
            onChange={e => changeTarget(i, Number(e.target.value))}
          />
        </div>
      ))}
    </>
  );
}
