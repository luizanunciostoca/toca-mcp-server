# Instagram publication reconciliation

A TOCA-managed Instagram job must never retry a provider write solely because local scheduler state is stale.

Before a due job performs a provider write, the runtime must reconcile provider-backed evidence. A unique provider match may promote local state to published; ambiguous evidence must fail closed. Successful writes must retain the provider media identifier and permalink as durable execution evidence.
