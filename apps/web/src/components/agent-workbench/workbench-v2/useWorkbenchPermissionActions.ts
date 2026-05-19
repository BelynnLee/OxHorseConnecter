import type { Dispatch, SetStateAction } from 'react';
import type {
  AgentWorkbenchApi,
  WorkbenchPermissionRule,
  WorkbenchPermissionRuleInput,
} from './types.ts';
import { useT } from '../../../i18n/index.ts';
import { getErrorMessage } from '../../../lib/format.ts';

type PermissionBusyAction = 'permission';

export function useWorkbenchPermissionActions({
  api,
  setPermissionRules,
  setBusyAction,
  setLoadError,
}: {
  api: AgentWorkbenchApi;
  setPermissionRules: Dispatch<SetStateAction<WorkbenchPermissionRule[]>>;
  setBusyAction: (value: PermissionBusyAction | undefined) => void;
  setLoadError: (value: string) => void;
}) {
  const { t } = useT();

  async function handleCreatePermissionRule(input: WorkbenchPermissionRuleInput) {
    setBusyAction('permission');
    try {
      const created = await api.createPermissionRule(input);
      setPermissionRules((current) => [created, ...current]);
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.createPermissionRule));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleTogglePermissionRule(rule: WorkbenchPermissionRule) {
    setBusyAction('permission');
    try {
      const updated = await api.updatePermissionRule(rule.id, { enabled: !rule.enabled });
      setPermissionRules((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.updatePermissionRule));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleDeletePermissionRule(ruleId: string) {
    setBusyAction('permission');
    try {
      await api.deletePermissionRule(ruleId);
      setPermissionRules((current) => current.filter((rule) => rule.id !== ruleId));
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.deletePermissionRule));
    } finally {
      setBusyAction(undefined);
    }
  }

  return {
    handleCreatePermissionRule,
    handleTogglePermissionRule,
    handleDeletePermissionRule,
  };
}
