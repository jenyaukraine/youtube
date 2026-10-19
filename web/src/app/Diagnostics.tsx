import type { SystemMetrics } from '@/lib/types';

interface Props {
  system: SystemMetrics;
  log: string[];
}

export function Diagnostics({ system, log }: Props) {
  return (
    <details className="fold">
      <summary>Диагностика сервера</summary>
      <div className="metrics">
        <span>
          CPU <b>{system.cpu_percent}%</b>
        </span>
        <span>
          RAM <b>{system.memory_percent}%</b>
        </span>
        <span>
          Процессов Chrome <b>{system.chromium_processes}</b>
        </span>
      </div>
      <div className="log">
        {log.slice(-60).map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </details>
  );
}
