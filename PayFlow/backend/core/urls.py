from django.urls import path
from rest_framework.routers import SimpleRouter

from backoffice import views as backoffice
from fraud import views as fraud
from ledger import views as ledger
from payments import views as payments
from webhooks import views as webhooks

from .stats import MeView, OverviewView

router = SimpleRouter(trailing_slash=False)
router.register("accounts", ledger.AccountViewSet, basename="account")

urlpatterns = [
    *router.urls,
    path("me", MeView.as_view()),
    path("stats/overview", OverviewView.as_view()),
    path("transactions", ledger.TransactionListView.as_view()),
    path("payments", payments.PaymentListCreateView.as_view()),
    path("payments/<uuid:pk>", payments.PaymentDetailView.as_view()),
    path("payments/<uuid:pk>/capture", payments.PaymentCaptureView.as_view()),
    path("payments/<uuid:pk>/void", payments.PaymentVoidView.as_view()),
    path("refunds", payments.RefundListCreateView.as_view()),
    path("fraud/review-queue", fraud.ReviewQueueView.as_view()),
    path("fraud/review/<uuid:payment_id>/resolve", fraud.ReviewResolveView.as_view()),
    path("fraud/model", fraud.ModelInfoView.as_view()),
    path("webhooks/endpoint", webhooks.EndpointView.as_view()),
    path("webhooks/deliveries", webhooks.DeliveryListView.as_view()),
    path("webhooks/deliveries/<uuid:pk>/retry", webhooks.DeliveryRetryView.as_view()),
    path("reconciliation/runs", backoffice.ReconciliationRunListView.as_view()),
    path("settlements", backoffice.SettlementListView.as_view()),
    path("settlements/run", backoffice.SettlementRunView.as_view()),
]
