# Bridge Architecture

```mermaid
flowchart LR
  subgraph A[Chain A - Settlement (1111)]
    U[User]
    VT[VaultToken]
    BL[BridgeLock]
    GE[GovernanceEmergency]
    U -->|lock(amount)| BL
    BL -->|custody| VT
    GE -->|pauseBridge()| BL
  end

  subgraph B[Chain B - Execution (2222)]
    WVT[WrappedVaultToken]
    BM[BridgeMint]
    GV[GovernanceVoting]
    U2[User]
    BM -->|mint| WVT
    U2 -->|burn(amount)| BM
    U2 -->|vote| GV
  end

  R[Relayer]
  DB[(processed_nonces.json)]

  BL -. Locked(user,amount,nonce) .-> R
  BM -. Burned(user,amount,nonce) .-> R
  GV -. ProposalPassed(id,data) .-> R

  R -->|mintWrapped(user,amount,nonce)| BM
  R -->|unlock(user,amount,nonce)| BL
  R -->|pauseBridge()| GE
  R <-->|load/save| DB
```
