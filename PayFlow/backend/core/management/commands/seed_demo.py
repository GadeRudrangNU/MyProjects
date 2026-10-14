from pathlib import Path

from django.core.management.base import BaseCommand

from core.models import ApiClient
from ledger.models import Account
from ledger.services import deposit

FRONTEND_ENV = Path(__file__).resolve().parents[4] / "frontend" / ".env.local"


class Command(BaseCommand):
    help = "Create a demo tenant with a few accounts and print its API key (also written to frontend/.env.local)."

    def add_arguments(self, parser):
        parser.add_argument("--name", default="Demo Marketplace")
        parser.add_argument("--no-frontend-env", action="store_true")

    def handle(self, *args, name, no_frontend_env, **options):
        client, raw_key = ApiClient.create_with_key(name)
        merchants = [
            Account.objects.create(client=client, name=n, kind=Account.Kind.MERCHANT)
            for n in ("Northwind Books", "Harbor Coffee Roasters")
        ]
        customers = [
            Account.objects.create(client=client, name=n, kind=Account.Kind.CUSTOMER)
            for n in ("Ava Martinez", "Liam Chen", "Noor Hassan")
        ]
        for customer in customers:
            deposit(client=client, account=customer, amount=250_000)
        self.stdout.write(f"client_id={client.id}")
        self.stdout.write(f"api_key={raw_key}")
        self.stdout.write(f"accounts={len(customers) + len(merchants)} (customers funded with $2,500.00)")
        if not no_frontend_env:
            FRONTEND_ENV.parent.mkdir(parents=True, exist_ok=True)
            FRONTEND_ENV.write_text(f"VITE_DEMO_API_KEY={raw_key}\n")
            self.stdout.write(f"wrote {FRONTEND_ENV}")
