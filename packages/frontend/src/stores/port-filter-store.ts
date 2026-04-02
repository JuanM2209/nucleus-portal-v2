import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Default system/ephemeral ports that clutter the device detail view */
const DEFAULT_HIDDEN_PORTS: readonly number[] = [
  53,     // DNS resolver
  3310,   // ClamAV
  5355,   // LLMNR
  9000,   // Internal service
  33683, 34979, 35365, 36083, 40051, 41075, 44875, 46813, // Ephemeral/dynamic
];

interface PortFilterState {
  /** Whether system port hiding is enabled */
  readonly hideSystemPorts: boolean;
  /** Set of port numbers to hide when hideSystemPorts is true */
  readonly hiddenPorts: readonly number[];
  /** Toggle the hide/show system ports setting */
  readonly toggleHideSystemPorts: () => void;
  /** Set hideSystemPorts explicitly */
  readonly setHideSystemPorts: (value: boolean) => void;
  /** Add a port to the hidden list */
  readonly addHiddenPort: (port: number) => void;
  /** Remove a port from the hidden list */
  readonly removeHiddenPort: (port: number) => void;
  /** Reset hidden ports to defaults */
  readonly resetHiddenPorts: () => void;
  /** Replace entire hidden ports list */
  readonly setHiddenPorts: (ports: readonly number[]) => void;
  /** Check if a port should be visible */
  readonly isPortVisible: (port: number) => boolean;
}

export const usePortFilterStore = create<PortFilterState>()(
  persist(
    (set, get) => ({
      hideSystemPorts: true,
      hiddenPorts: [...DEFAULT_HIDDEN_PORTS],

      toggleHideSystemPorts: () => set((s) => ({ hideSystemPorts: !s.hideSystemPorts })),
      setHideSystemPorts: (value) => set({ hideSystemPorts: value }),

      addHiddenPort: (port) =>
        set((s) => {
          if (s.hiddenPorts.includes(port)) return s;
          return { hiddenPorts: [...s.hiddenPorts, port].sort((a, b) => a - b) };
        }),

      removeHiddenPort: (port) =>
        set((s) => ({ hiddenPorts: s.hiddenPorts.filter((p) => p !== port) })),

      resetHiddenPorts: () => set({ hiddenPorts: [...DEFAULT_HIDDEN_PORTS] }),

      setHiddenPorts: (ports) => set({ hiddenPorts: [...ports].sort((a, b) => a - b) }),

      isPortVisible: (port) => {
        const state = get();
        if (!state.hideSystemPorts) return true;
        return !state.hiddenPorts.includes(port);
      },
    }),
    { name: 'nucleus-port-filter' },
  ),
);

export { DEFAULT_HIDDEN_PORTS };
