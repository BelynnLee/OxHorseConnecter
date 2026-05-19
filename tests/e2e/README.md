Workbench E2E coverage lives in `e2e/agent-workbench.spec.ts`.

Run it from the workspace root with:

```powershell
pnpm test:e2e:workbench
```

The scripted E2E path starts a disposable Host database and Vite web server,
then covers the Workbench shell, mock adapter interactions, inspector actions,
slash menu behavior, and protected real-adapter route loading.
