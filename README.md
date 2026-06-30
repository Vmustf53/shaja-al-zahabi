# شجا الذهبي — SHAJA-AL-ZAHABI

Integrated shop management system for a tailoring materials business in Jaleeb Al Shouyoukh, Kuwait — built as a hands-on DevOps/Cloud engineering portfolio project.

## What this is

Two purposes, equal weight: solve real operational problems for a family-run tailoring materials shop, **and** serve as a complete, defensible DevOps portfolio project. Every technical decision is made to maximize hands-on learning — IaC, containers, Kubernetes, CI/CD, monitoring — never console click-ops.

## Status: Phase 1.1 — Foundation ✅

- 3 Node.js/Express microservices: `inventory-service`, `pos-service`, `crm-service`
- PostgreSQL 15 with full schema (bilingual products, dual retail/wholesale pricing, separate shopfloor/warehouse stock, low-stock alerts, customer credit balances)
- Fully containerized with Docker (multi-stage builds, ARM64 native)
- Deployed and verified on a local K3s cluster (k3d) via Nginx Ingress Controller
- Verified end-to-end: real API responses for products, stock levels, and customer balances

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 18 + Express |
| Database | PostgreSQL 15 |
| Containers | Docker (multi-stage builds) |
| Orchestration | Kubernetes (K3s via k3d, locally) |
| Ingress | Nginx Ingress Controller |
| CI/CD | GitHub Actions *(Phase 1.2)* |
| Monitoring | Prometheus + Grafana + Loki *(Phase 1.2)* |

## Architecture

```
services/
  inventory/   — products, variants, pricing, stock transfers, suppliers   (:3001)
  pos/         — billing, dual pricing engine, payments, credit tracking   (:3002)
  crm/         — customer/tailor profiles, balances, loyalty                (:3003)
db/
  schema.sql   — full PostgreSQL schema + seed data
k8s/
  base/        — Kubernetes manifests (namespace, configmap, secret,
                  postgres StatefulSet, service deployments, ingress)
scripts/
  deploy-local.sh — one-command deploy to local k3d cluster
docker-compose.yml — local dev stack (alternative to k8s for quick iteration)
```

## Quick start — local Kubernetes

```bash
# 1. Create the local cluster (first time only)
k3d cluster create shaja-local \
  --port "8080:30080@server:0" \
  --port "8443:30443@server:0"

# 2. Deploy everything
chmod +x scripts/deploy-local.sh
./scripts/deploy-local.sh

# 3. Test
curl http://localhost:8080/api/inventory/products
curl http://localhost:8080/api/inventory/stock/low
curl http://localhost:8080/api/crm/customers
```

## Quick start — Docker Compose (faster iteration)

```bash
docker compose up --build
curl http://localhost:8090/api/inventory/products
```

## Roadmap

- [x] Phase 1.1 — Backend foundation, Docker, local Kubernetes
- [ ] Phase 1.2 — GitHub Actions CI/CD, Prometheus/Grafana/Loki observability
- [ ] Phase 1.3 — Tailor portal, WhatsApp notifications, loyalty
- [ ] Phase 2 — Dasha Builder (interactive kit assembly tool)
- [ ] Phase 3 — Public e-commerce site, KNET payments
- [ ] Phase 4 — Migration to AWS EKS for production

## Author

Built by [@Vmusft53](https://github.com/Vmusft53) — CS student, aspiring Cloud & DevOps Engineer.
