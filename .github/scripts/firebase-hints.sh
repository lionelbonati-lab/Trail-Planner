#!/usr/bin/env bash
# Erreurs connues d'un déploiement Firebase (journaux de firebase-tools) expliquées en français : en tête
# de la page de l'action GitHub (annotations) et dans son résumé (liens cliquables).
# Usage : firebase-hints.sh <journal>...   Variables : PROJECT, REGION (facultatives).
PROJECT="${PROJECT:-trail-planner-814f6}"
REGION="${REGION:-europe-west1}"
LOG=$(cat "$@" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')
[ -n "$LOG" ] || exit 0

IAM="https://console.cloud.google.com/iam-admin/iam?project=$PROJECT"
DOC="docs/notifications.md"
FOUND=0

has() { grep -qiE "$1" <<<"$LOG"; }

# say <error|warning|notice> <titre> <texte> : une annotation (une ligne) et le même texte dans le résumé.
say() {
  echo "::$1 title=$2::$3"
  if [ -n "$GITHUB_STEP_SUMMARY" ]; then
    [ "$FOUND" = 0 ] && echo "### Déploiement Firebase : que faire" >> "$GITHUB_STEP_SUMMARY"
    printf -- '- **%s** : %s\n' "$2" "$3" >> "$GITHUB_STEP_SUMMARY"
  fi
  FOUND=1
}

if has 'Permissions? denied (enabling|to enable service)'; then
  APIS=$(grep -oiE 'Permissions? denied (enabling |to enable service \[)[a-z0-9.-]+' <<<"$LOG" \
    | grep -oE '[a-z0-9-]+\.googleapis\.com' | sort -u | paste -sd ' ' -)
  say error "Services Google inactifs" "Le compte github-deploy ne peut pas activer ${APIS:-un service Google}. Lui ajouter le rôle « Administrateur Service Usage » (Service Usage Admin) dans Google Cloud → IAM ($IAM), attendre 2 min, puis relancer l'action (Run workflow). Voir $DOC."
fi

if has 'must be on the Blaze|requires the pay-as-you-go \(Blaze\)'; then
  say error "Forfait Blaze" "Les fonctions Cloud demandent le forfait Blaze (paiement à l'usage, gratuit à cette échelle) : le choisir dans la console Firebase (https://console.firebase.google.com/project/$PROJECT/usage/details), puis relancer l'action."
fi

if has 'Error generating the service identity'; then
  say error "Agents de service Google" "Création d'un agent de service (Pub/Sub, Eventarc) refusée. Ajouter à github-deploy le rôle « Administrateur Service Usage » (Service Usage Admin) dans Google Cloud → IAM ($IAM), puis relancer l'action."
fi

if has 'failed to modify the IAM policy'; then
  say error "Droits des services Google" "Le premier déploiement donne des droits aux services de Google (déclencheurs Firestore) : ajouter à github-deploy le rôle « Administrateur de l'IAM du projet » (Project IAM Admin) dans Google Cloud → IAM ($IAM), puis relancer l'action. Ce rôle peut être retiré après le premier déploiement réussi."
fi

if has 'iam\.serviceAccounts\.actAs'; then
  say error "Utilisateur du compte de service" "Ajouter à github-deploy le rôle « Utilisateur du compte de service » (Service Account User) dans Google Cloud → IAM ($IAM), puis relancer l'action."
fi

if has 'missing permission on the build service account'; then
  say error "Compte de construction" "Google ne peut pas construire les fonctions : dans Google Cloud → IAM ($IAM), donner au compte « Compte de service Compute Engine par défaut » (…-compute@developer.gserviceaccount.com) le rôle « Compte de service Cloud Build » (Cloud Build Service Account), puis relancer l'action."
fi

if has 'permissions are propagated to the Service Agent|Retry the deployment in a few minutes'; then
  say notice "Premier déploiement" "Google finit de préparer les déclencheurs (Eventarc) : relancer l'action dans 5 minutes (Run workflow). Rien à changer."
fi

if has 'Timed out waiting for API'; then
  say notice "Activation lente" "Un service Google met du temps à s'activer : relancer l'action dans quelques minutes."
fi

if has 'Failed to authenticate|invalid_grant|Invalid JWT Signature'; then
  say error "Clé de déploiement" "La clé du secret FIREBASE_SERVICE_ACCOUNT est refusée (supprimée, ou mal copiée) : créer une nouvelle clé JSON pour github-deploy et remplacer le secret. Voir $DOC."
fi

if has 'could not set up cleanup policy|Failed to set up cleanup policy'; then
  say warning "Anciennes versions des fonctions" "Fonctions déployées, mais leurs anciennes versions ne sont pas effacées (quelques centimes de stockage à la longue). Pour les effacer automatiquement : ajouter à github-deploy le rôle « Administrateur Artifact Registry » (Artifact Registry Administrator) dans Google Cloud → IAM ($IAM)."
fi

# Autre refus : le détail est dans le journal (option « debug » au lancement manuel).
if [ "$FOUND" = 0 ] && has 'HTTP Error: 403|PERMISSION_DENIED|does not have permission'; then
  say error "Permission manquante" "Un droit manque au compte github-deploy. Relancer l'action avec l'option « Journal détaillé » : le journal nomme la permission refusée. Voir $DOC."
fi
exit 0
