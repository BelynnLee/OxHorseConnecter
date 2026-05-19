import { useContext } from 'react';
import { PageHeaderContext } from './page-header-context.ts';

export function usePageHeader() {
  return useContext(PageHeaderContext);
}
