import { Profiler, useRef, type ComponentType, type ProfilerOnRenderCallback } from 'react';

// Opt-in local measurements, exposed through a hidden DOM output for the browser harness.
// No recording, persistence or network traffic in the normal product view.
export function measureWorkspace(name: string, Page: ComponentType) {
  return function MeasuredWorkspace() {
    const output = useRef<HTMLOutputElement>(null);
    const samples = useRef<{ phase: string; duration: number; at: number }[]>([]);
    if (!new URLSearchParams(location.search).has('measure')) return <Page />;
    const record: ProfilerOnRenderCallback = (_id, phase, duration, _base, _start, at) => {
      samples.current = [...samples.current.slice(-199), { phase, duration, at }];
      if (output.current) output.current.dataset.samples = JSON.stringify(samples.current);
    };
    return (
      <>
        <output hidden data-workspace-measure={name} ref={output} />
        <Profiler id={name} onRender={record}>
          <Page />
        </Profiler>
      </>
    );
  };
}
