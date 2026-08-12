# TOCA MCP Infrastructure Control Plane

## Objetivo

Permitir que o TOCA OS administre infraestrutura aprovada sem conceder privilégios administrativos ao runtime ou ao deployer cotidiano.

## Separação de identidades

- `toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`: runtime de produção. Recebe apenas permissões necessárias durante a execução da aplicação.
- `toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com`: deploy cotidiano. Não é administrador de infraestrutura.
- `toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com`: identidade dedicada ao Infrastructure Control Plane. Autentica somente via GitHub OIDC / Workload Identity Federation e nunca usa chave JSON.

## Envelope de autoridade

A identidade de infraestrutura não recebe `roles/owner`, `roles/editor` nem capacidade de gerar service-account keys. O primeiro custom role contém somente:

- `storage.buckets.create`
- `storage.buckets.get`
- `storage.buckets.getIamPolicy`
- `storage.buckets.setIamPolicy`
- `storage.buckets.update`

`storage.buckets.delete` fica deliberadamente ausente.

A definição canônica do papel é `infra/control-plane/storage-bucket-admin-role.yaml`.

## Policy boundary

`infra/control-plane/policy.json` é a fonte versionada das operações permitidas. O workflow calcula o SHA-256 desse arquivo e exige que o chamador informe exatamente esse hash. Se o policy mudar, uma autorização baseada no hash anterior não executa.

O workflow também valida o nome exato do recurso e a operação permitida. Não existe parâmetro para shell arbitrário ou `gcloud` livre.

## Workflow protegido

`.github/workflows/infrastructure-control-plane.yml`:

- somente `workflow_dispatch`;
- checkout obrigatório de `main`;
- GitHub Environment `infrastructure-admin`;
- OIDC/WIF, sem chave longa;
- autenticação somente como `toca-mcp-infra-admin`;
- operação tipada e enumerada;
- verificação pós-execução obrigatória.

A configuração do GitHub Environment deve restringir deployments ao branch `main`. Se a organização desejar aprovação humana para mudanças de alto impacto, adicionar required reviewers ao Environment. A ausência de reviewer não altera o boundary criptográfico/policy do workflow, mas reduz a barreira humana.

## Bootstrap único

A criação inicial da identidade administrativa e do custom role precisa ser feita por uma identidade humana/administrativa já autorizada no projeto. Isso é intencional: o sistema não pode conceder a si próprio poderes novos.

Com uma identidade administrativa no Cloud Shell:

```bash
PROJECT_ID=toca-mcp-production
PROJECT_NUMBER=990081828836
POOL=github
REPO=luizidebook/toca-mcp-server
INFRA_SA=toca-mcp-infra-admin
ROLE_ID=tocaMcpInfrastructureStorageAdmin

gcloud iam service-accounts create "$INFRA_SA" \
  --project "$PROJECT_ID" \
  --display-name="TOCA MCP Infrastructure Control Plane"

gcloud iam roles create "$ROLE_ID" \
  --project "$PROJECT_ID" \
  --file=infra/control-plane/storage-bucket-admin-role.yaml

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${INFRA_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="projects/${PROJECT_ID}/roles/${ROLE_ID}"

gcloud iam service-accounts add-iam-policy-binding \
  "${INFRA_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project "$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"
```

Antes do comando de criação do custom role, o arquivo YAML deve estar disponível localmente no Cloud Shell (por clone do repositório ou upload controlado).

## Evolução futura

Novos tipos de infraestrutura devem entrar em milestones próprios. Cada expansão deve:

1. adicionar permissões mínimas a um custom role versionado ou criar um novo papel específico;
2. adicionar uma operação enumerada ao `policy.json`;
3. adicionar execução explícita ao workflow;
4. adicionar verificações no architecture check;
5. passar pelo Quality Gate;
6. nunca conceder Owner/Editor ou permissão de autoelevação.

A ampliação do envelope IAM continua sendo uma ação excepcional de bootstrap/admin. Operações dentro do envelope passam a ser autônomas e repetíveis.

## Modelo de segurança

O TOCA OS pode evoluir e reconciliar sua infraestrutura, mas não pode ampliar sozinho os próprios privilégios. Essa separação preserva autonomia operacional sem criar um caminho de privilege escalation.
