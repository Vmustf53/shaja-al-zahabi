#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# SHAJA-AL-ZAHABI — Deploy to local k3d cluster (shaja-local)
#
# DevOps Learning: k3d runs Kubernetes INSIDE Docker containers, which means
# it has its own separate image store — images built with `docker build` or
# `docker compose build` on your Mac are NOT automatically visible inside k3d.
# `k3d image import` copies them in. This step doesn't exist on cloud
# Kubernetes (EKS/GKE) because there you push to a real registry (ECR/GCR)
# instead — this script is a close local stand-in for that registry push.
# ══════════════════════════════════════════════════════════════════════════════
set -e   # exit immediately if any command fails

CLUSTER_NAME="shaja-local"
NAMESPACE="shaja"

echo "════════════════════════════════════════════"
echo " SHAJA-AL-ZAHABI — Local Kubernetes Deploy"
echo "════════════════════════════════════════════"

# ── Step 1: Confirm cluster is running ────────────────────────────────────────
echo ""
echo "→ Checking k3d cluster '$CLUSTER_NAME'..."
if ! k3d cluster list | grep -q "$CLUSTER_NAME"; then
  echo "✗ Cluster '$CLUSTER_NAME' not found. Create it first with:"
  echo "  k3d cluster create $CLUSTER_NAME --port '8080:30080@server:0' --port '8443:30443@server:0'"
  echo ""
  echo "  Note: ports map to FIXED NodePorts (30080/30443) that the Nginx"
  echo "  Ingress Controller below is configured to use — this avoids the"
  echo "  k3d LoadBalancer '<pending>' EXTERNAL-IP issue entirely."
  exit 1
fi
kubectl cluster-info --context "k3d-$CLUSTER_NAME" > /dev/null 2>&1 || { echo "✗ Cluster not reachable"; exit 1; }
echo "✓ Cluster is up"

# ── Step 2: Build the three service images (if not already built) ───────────
echo ""
echo "→ Building Docker images..."
docker build -t shaja-al-zahabi-inventory-service:latest ./services/inventory
docker build -t shaja-al-zahabi-pos-service:latest ./services/pos
docker build -t shaja-al-zahabi-crm-service:latest ./services/crm
echo "✓ Images built"

# ── Step 3: Import images into k3d's internal image store ───────────────────
echo ""
echo "→ Importing images into k3d cluster..."
k3d image import \
  shaja-al-zahabi-inventory-service:latest \
  shaja-al-zahabi-pos-service:latest \
  shaja-al-zahabi-crm-service:latest \
  -c "$CLUSTER_NAME"
echo "✓ Images imported"

# ── Step 4: Generate AND apply the real Postgres init ConfigMap FIRST ───────
# DevOps note: this MUST happen before 03-postgres.yaml is applied. Postgres
# only runs /docker-entrypoint-initdb.d/*.sql on first boot of an EMPTY data
# directory — if the StatefulSet pod starts before the real ConfigMap exists,
# it mounts whatever is there and never re-runs init again on that PVC.
echo ""
echo "→ Generating and applying Postgres init ConfigMap from db/schema.sql..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap postgres-init-schema \
  --from-file=schema.sql=./db/schema.sql \
  --namespace="$NAMESPACE" \
  --dry-run=client -o yaml | kubectl apply -f -
echo "✓ Real schema ConfigMap applied"

# ── Step 5: Install Nginx Ingress Controller (only if not already installed) ─
echo ""
echo "→ Checking Nginx Ingress Controller..."
if ! kubectl get namespace ingress-nginx > /dev/null 2>&1; then
  echo "  Installing Nginx Ingress Controller via Helm..."
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx --force-update
  helm repo update
  helm install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx --create-namespace
  echo "  Waiting for Ingress Controller to be ready..."
  kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=120s

  # DevOps note: Helm chart --set paths for NodePort values are fragile and
  # change between chart versions. A direct kubectl patch is guaranteed to
  # work regardless of chart version — this forces fixed NodePorts 30080/30443
  # to match the k3d cluster's port mapping (--port "8080:30080@server:0").
  echo "  Patching Service to use fixed NodePorts (30080/30443)..."
  kubectl patch svc ingress-nginx-controller -n ingress-nginx -p \
    '{"spec":{"type":"NodePort","ports":[{"name":"http","port":80,"targetPort":"http","nodePort":30080,"protocol":"TCP"},{"name":"https","port":443,"targetPort":"https","nodePort":30443,"protocol":"TCP"}]}}'
else
  echo "✓ Ingress Controller already installed"
  echo "  Ensuring fixed NodePorts (30080/30443) are still set..."
  kubectl patch svc ingress-nginx-controller -n ingress-nginx -p \
    '{"spec":{"type":"NodePort","ports":[{"name":"http","port":80,"targetPort":"http","nodePort":30080,"protocol":"TCP"},{"name":"https","port":443,"targetPort":"https","nodePort":30443,"protocol":"TCP"}]}}' \
    2>/dev/null || true
fi

# ── Step 6: Apply remaining manifests in order ────────────────────────────────
echo ""
echo "→ Applying Kubernetes manifests..."
kubectl apply -f k8s/base/01-configmap.yaml
kubectl apply -f k8s/base/02-secret.yaml
kubectl apply -f k8s/base/03-postgres.yaml
kubectl apply -f k8s/base/04-inventory.yaml
kubectl apply -f k8s/base/05-pos.yaml
kubectl apply -f k8s/base/06-crm.yaml

# ── Step 7: Wait for Postgres before applying Ingress (services need DB up) ──
echo ""
echo "→ Waiting for Postgres to be ready..."
kubectl wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app=postgres \
  --timeout=90s

echo ""
echo "→ Waiting for all services to be ready..."
kubectl wait --namespace "$NAMESPACE" \
  --for=condition=available deployment \
  --selector=app.kubernetes.io/part-of=shaja-al-zahabi \
  --timeout=120s 2>/dev/null || true

kubectl apply -f k8s/base/07-ingress.yaml

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo " ✓ Deployment complete!"
echo "════════════════════════════════════════════"
echo ""
echo "Check status with:"
echo "  kubectl get pods -n $NAMESPACE"
echo "  kubectl get ingress -n $NAMESPACE"
echo ""
echo "Test the API (via k3d load balancer on port 8080):"
echo "  curl http://localhost:8080/api/inventory/products"
echo ""
