Current integration entrypoint:

- `scripts/test-integration.ps1` boots the built Host service, logs in, trusts
  the local device, verifies approve / reject / cancel / timeout flows against
  the mock executor, and asserts the task summary + diff path.

Run it from the workspace root with:

```powershell
pnpm test:integration
```
