import { createContext, type ReactNode } from 'react';

export interface PageHeaderContextValue {
  setAfterTitle: (node: ReactNode) => void;
  setEnd: (node: ReactNode) => void;
  setTitle: (title: ReactNode | null) => void;
}

export const PageHeaderContext = createContext<PageHeaderContextValue>({
  setAfterTitle: () => undefined,
  setEnd: () => undefined,
  setTitle: () => undefined,
});
