from celery import shared_task

from core.models import ApiClient

from . import services


@shared_task(name="backoffice.run_reconciliation")
def run_reconciliation() -> str:
    """Nightly: reconcile every active client's ledger."""
    results = [services.reconcile(client).status for client in ApiClient.objects.filter(is_active=True)]
    return f"{len(results)} clients reconciled, {results.count('mismatch')} with mismatches"


@shared_task(name="backoffice.run_settlement")
def run_settlement() -> int:
    return len(services.run_settlement())
