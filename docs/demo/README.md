# demo — Demo Orchestration

**Single responsibility:** Seed two developer workspaces with realistic TypeScript files to demonstrate conflict detection.

---

## File Map

```
packages/demo/src/
├── seed.ts          ← simple auth scenario (4 files, 2 workspaces)
└── fintech-seed.ts  ← complex fintech scenario (9 files, higher blast radius)
```

---

## Simple Scenario (seed.ts)

Seeds both `workspace-devA/` and `workspace-devB/` with identical starting files:

```
workspace-devA/          workspace-devB/
├── auth.ts              ├── auth.ts
├── users.ts             ├── users.ts
├── sessions.ts          ├── sessions.ts
└── permissions.ts       └── permissions.ts
```

**Cross-file dependency graph (conflict trigger map):**

```
auth.ts                         users.ts
  loginUser()   ─calls─►  getUserByEmail()
  loginUser()   ─calls─►  createSession()   ◄─  sessions.ts
  hashPassword()◄─calls─  createUser()          validateSession()
  generateToken()◄─calls─ createSession()       revokeSession()

permissions.ts
  checkPermission()   (standalone — no inbound calls from above files)
  grantPermission()
```

**Designed conflicts:**
- Dev A changes `loginUser(email, password)` → `loginUser(email, password, mfaCode)` (auth_bypass, signature_drift)
- Dev B simultaneously modifies same function → collision detected
- Blast radius = all callers of `loginUser` transitively

---

## Fintech Scenario (fintech-seed.ts)

9-file scenario with higher blast radius (more interconnected entities):

```
accounts.ts    ← Account type, getAccount, createAccount, updateBalance
payments.ts    ← processPayment (calls getAccount, validateLimit, auditLog)
limits.ts      ← validateLimit (calls getAccount)
audit.ts       ← auditLog (standalone sink)
compliance.ts  ← checkCompliance (calls getAccount, auditLog)
fraud.ts       ← detectFraud (calls getAccount, auditLog)
notifications.ts ← sendNotification (standalone sink)
reports.ts     ← generateReport (calls getAccount, auditLog)
users.ts       ← getUserById, updateUserRole
```

**Blast radius example:**
If `getAccount()` signature changes:
- Direct dependents: `processPayment`, `validateLimit`, `checkCompliance`, `detectFraud`, `generateReport`
- Transitive: anything calling those functions
- BFS count = 5+ → `critical` severity

---

## How to Run

```bash
# seed simple scenario
npm run seed -w packages/demo

# seed fintech scenario
npm run seed:fintech -w packages/demo

# run demo agents (from repo root)
npm run demo
```

Both seed scripts write files to `packages/demo/workspace-devA/` and `packages/demo/workspace-devB/`.
The clients in those workspaces then pick up the files via chokidar and stream them to the server.
